"""Extract/reset a Word QA protocol and fill it from independently recorded results.

Uses only Python's standard library. Never modifies the source document.
"""
import argparse
import copy
import hashlib
import io
import json
import os
import re
import zipfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from xml.etree import ElementTree as ET

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
NS = {'w': W[1:-1]}
CASE = re.compile(r'^([A-Z]{2,5})\s+(\d{2})\s+(.+)$')
STATES = ['APROBADO', 'FALLIDO', 'PARCIAL', 'BLOQUEADO', 'NO APLICA', 'NO EJECUTADO']
RESULT_LABELS = ['Estado actual', 'Fecha y entorno', 'Usuario o rol', 'Pasos realizados',
                 'Resultado observado', 'Adaptación a Firestore', 'Evidencias', 'Pendiente o limitación']

def adapt_persistence(value):
    """Translate mechanisms, preserving functional assertions and code/CI references."""
    replacements = {
        'persiste en GitHub': 'persiste en Firestore',
        'GitHub contiene ambos cambios': 'Firestore contiene ambos cambios',
        'Deja que GitHub escriba': 'Deja que Firestore confirme la escritura',
        'Se restaura desde GitHub': 'Se restaura desde Firestore',
        'integración GitHub de producción': 'integración real de Firestore',
        'credencial GitHub': 'credencial de infraestructura',
        'acceso genérico GitHub': 'acceso genérico a Firestore',
        'token GitHub': 'credenciales de Firestore',
        'IndexedDB Worker GitHub JSON y render': 'IndexedDB Worker Firestore serialización y render',
        'blobs por SHA cuando corresponde': 'documentos y segmentos de Firestore según el modelo vigente',
        'archivos remotos confirmados': 'documentos persistidos confirmados',
        'archivo remoto ya no exista': 'documento persistido ya no exista',
        'No hay nuevos commits ni revisiones': 'No hay nuevas escrituras ni revisiones',
        'Las descargas usan SHA': 'Las descargas usan revisiones',
        'conflicto SHA': 'conflicto de revisión',
        'SHA obsoleto de catálogo': 'Revisión obsoleta del catálogo',
        'mismo SHA': 'misma revisión',
        'SHA válido': 'revisión válida',
        'SHA correcto': 'revisión correcta',
        'SHA antiguo': 'revisión antigua',
        'SHA desactualizado': 'revisión desactualizada',
        'con SHA y hora': 'con revisión y hora',
        'lista final y SHA': 'lista final y revisión',
        'registra solicitudes y SHA': 'registra solicitudes y revisiones',
        'para verificar permisos, SHA y recuperación': 'para verificar permisos, revisiones y recuperación',
        'repositorio de datos': 'datos persistidos en Firestore',
        'Autoridad de los archivos': 'Autoridad de los datos persistentes',
        'Archivo o dato': 'Entidad o dato',
        'Archivos de otras cuentas': 'Documentos de otras cuentas',
        'SHA/revisión/checkpoint': 'revisión/checkpoint',
        'user_data.json': 'perfil persistido',
        'tecnics.json': 'repertorio persistido',
        'trainer_comments.json': 'comentarios persistidos',
        'plans.json e índices': 'asignaciones e índices de planes',
        'training_plans': 'planes y sesiones persistidas',
        'GitHub/SHA reinterpretados como Firestore y versiones CAS.': 'Persistencia Firestore y control de versiones CAS.',
        'Token GitHub o servicio remoto inválido': 'Credenciales de Firestore o servicio remoto inválido',
        'resolucion SHA local/remoto': 'resolución de versiones local/remoto',
        'Modelo nativo no utiliza blobs GitHub.': 'El modelo nativo utiliza documentos y segmentos de Firestore.',
        'Firestore unico remoto. No existe componente GitHub; no se infiere costo facturable desde llamadasHTTP.': 'Firestore es la única persistencia remota de negocio; las llamadas HTTP no equivalen a operaciones facturables.',
        'Una única identidad normalizada y carpeta': 'Una única identidad normalizada y conjunto de documentos propio',
        'No se escribe en otra carpeta de alumno': 'No se escribe en documentos de otro alumno',
        'escritura fuera de raíz del usuario': 'escritura en entidades ajenas al usuario',
        'No se borran carpetas reales ni datos compartidos': 'No se borran documentos de usuarios reales ni datos compartidos',
    }
    for old, new in replacements.items():
        value = value.replace(old, new)
    return value

def text(node):
    return ''.join(n.text or '' for n in node.iter(W + 't'))

def scrub(value):
    value = str(value)
    value = re.sub(r'(?i)((?:password|contraseña|token|cookie)\s*[:=]\s*)\S+', r'\1[REDACTADO]', value)
    return value

def set_text(p, value):
    props = p.find(W + 'pPr')
    first = p.find(W + 'r')
    runprops = copy.deepcopy(first.find(W + 'rPr')) if first is not None and first.find(W + 'rPr') is not None else None
    for child in list(p):
        if child is not props:
            p.remove(child)
    run = ET.SubElement(p, W + 'r')
    if runprops is not None:
        run.append(runprops)
    for index, line in enumerate(scrub(value).split('\n')):
        if index:
            ET.SubElement(run, W + 'br')
        t = ET.SubElement(run, W + 't')
        t.set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')
        t.text = line

def read_source(path):
    with zipfile.ZipFile(path) as source:
        if any(name.startswith('word/comments') and name.endswith('.xml') for name in source.namelist()):
            raise ValueError('Source contains Word comments: resolve/strip them on a working copy with the Documents skill before extraction; never edit the original')
        data = source.read('word/document.xml')
        for _, (prefix, uri) in ET.iterparse(io.BytesIO(data), events=['start-ns']):
            if not re.fullmatch(r'ns\d+', prefix):
                ET.register_namespace(prefix, uri)
        root = ET.fromstring(data)
    return root

def cases(root):
    records = []
    block = ''
    current = None
    paragraphs = list(root.find('w:body', NS).findall('w:p', NS))
    for index, p in enumerate(paragraphs):
        value = text(p).strip()
        style = p.find('w:pPr/w:pStyle', NS)
        name = style.get(W + 'val', '') if style is not None else ''
        if name == 'Heading1':
            block = value
            current = None
        match = CASE.match(value) if name == 'Heading2' else None
        if match:
            current = {'id': match[1] + ' ' + match[2], 'title': scrub(match[3]), 'block': block,
                       'priority': '', 'steps': '', 'expected': '', 'status': 'NO EJECUTADO',
                       'sourceParagraph': index, 'resultParagraphs': {}}
            records.append(current)
        elif current:
            if value.startswith('Prioridad '):
                current['priority'] = scrub(value[len('Prioridad '):])
            elif value.startswith('Pasos ') and not value.startswith('Pasos realizados'):
                current['steps'] = scrub(value[len('Pasos '):])
            elif value.startswith('Resultado esperado ') and not current['expected']:
                current['expected'] = scrub(value[len('Resultado esperado '):])
            else:
                for label in RESULT_LABELS:
                    if value == label or value.startswith(label + ' '):
                        current['resultParagraphs'][label] = index
                        break
    return records, paragraphs

def extract(args):
    source = Path(args.source).resolve()
    root = read_source(source)
    records, _ = cases(root)
    if not records:
        raise ValueError('No recognizable case headings; add an explicit document adapter before proceeding')
    if len({r['id'] for r in records}) != len(records):
        raise ValueError('Duplicate case identifiers')
    manifest = {'schemaVersion': 1, 'campaign': args.campaign,
                'createdAt': datetime.now(timezone.utc).isoformat(),
                'source': str(source), 'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
                'caseCount': len(records), 'blocks': dict(Counter(r['block'] for r in records)), 'cases': records}
    destination = Path(args.output)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    body = root.find('w:body', NS)
    annex = []
    collecting = False
    for node in body:
        value = text(node).strip()
        if value == 'Reglas vigentes que cambian el protocolo anterior':
            collecting = True
        if collecting and CASE.match(value):
            break
        if collecting and value:
            if node.tag == W + 'tbl':
                annex.append({'kind': 'table', 'rows': [[text(c) for c in row.findall('w:tc', NS)] for row in node.findall('w:tr', NS)]})
            else:
                annex.append({'kind': 'paragraph', 'text': scrub(value)})
    destination.with_name('annex.json').write_text(json.dumps(annex, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'caseCount': len(records), 'blocks': manifest['blocks']}, ensure_ascii=False, indent=2))

def joined(value):
    return '; '.join(map(str, value)) if isinstance(value, list) else str(value or '')

def evidence_text(value, output):
    values = value if isinstance(value, list) else [value] if value else []
    displayed = []
    for reference in values:
        path = Path(str(reference))
        if path.is_absolute():
            displayed.append(os.path.relpath(path, Path(output).resolve().parent).replace('\\', '/'))
        else:
            displayed.append(str(reference))
    return '\n'.join(displayed)

def refresh_campaign_summary(root, paragraphs, campaign, counts, total):
    """Replace prior campaign results for raw and already-filled protocols."""
    start = next((i for i, p in enumerate(paragraphs)
                  if text(p).startswith('Resultados de la campaña')), None)
    if start is None:
        return
    introductions = ('Este documento sustituye el protocolo antiguo',
                     'Este documento conserva los objetivos del protocolo')
    end = next((i for i, p in enumerate(paragraphs)
                if i > start and text(p).startswith(introductions)), None)
    if end is None or end < start + 3:
        raise ValueError('Cannot safely locate the previous campaign executive summary')
    set_text(paragraphs[start], 'Resultados de la campaña ' + campaign)
    complete = counts['APROBADO'] + counts['FALLIDO']
    set_text(paragraphs[start + 1], ', '.join(state + ': ' + str(counts[state]) for state in STATES))
    set_text(paragraphs[start + 2], 'Ejecución completa: ' + f'{100 * complete / total:.2f}%' +
             '. Aprobación sobre ejecución completa: ' +
             (f'{100 * counts["APROBADO"] / complete:.2f}%' if complete else 'no calculable') + '.')
    body = root.find('w:body', NS)
    children = list(body)
    first = children.index(paragraphs[start + 2]) + 1
    last = children.index(paragraphs[end])
    # Account inventories and prior evidence may also be tables.
    for node in children[first:last]:
        body.remove(node)


def discard_previous_supplemental_incidents(root):
    """Keep the blank incident form, discarding old campaign-only findings."""
    body = root.find('w:body', NS)
    children = list(body)
    start = next((i for i, node in enumerate(children)
                  if text(node).startswith('Incidencias suplementarias fuera de los ')), None)
    if start is None:
        return
    end = next((i for i, node in enumerate(children)
                if i > start and text(node).startswith('ID de incidencia')), None)
    if end is None:
        raise ValueError('Cannot safely locate the blank incident form after previous supplemental findings')
    for node in children[start:end]:
        body.remove(node)


def fill(args):
    manifest = json.loads(Path(args.manifest).read_text(encoding='utf-8-sig'))
    source = Path(manifest['source'])
    if hashlib.sha256(source.read_bytes()).hexdigest() != manifest['sourceSha256']:
        raise ValueError('Source document changed since extraction')
    root = read_source(source)
    records, paragraphs = cases(root)
    results = {}
    for path in sorted(Path(args.results).glob('*.json')):
        result = json.loads(path.read_text(encoding='utf-8-sig'))
        if result['id'] in results:
            raise ValueError('Duplicate result for ' + result['id'])
        if result['status'] not in STATES:
            raise ValueError('Unknown status in ' + str(path))
        results[result['id']] = result
    unknown = set(results) - {r['id'] for r in records}
    if unknown:
        raise ValueError('Unknown result IDs: ' + repr(unknown))
    counts = Counter()
    for record in records:
        result = results.get(record['id'], {'id': record['id'], 'status': 'NO EJECUTADO'})
        counts[result['status']] += 1
        values = {
            'Estado actual': result['status'],
            'Fecha y entorno': joined(result.get('executedAt')) + ' | ' + joined(result.get('environment')),
            'Usuario o rol': joined(result.get('users')) + (' | ' + result['userMetadataNote'] if result.get('userMetadataNote') else ''),
            'Pasos realizados': joined(result.get('steps')) or 'No ejecutados en esta campaña.',
            'Resultado observado': joined(result.get('observed')) or 'Sin evidencia de ejecución de esta campaña.',
            'Adaptación a Firestore': joined(result.get('adaptation')) or 'Persistencia de negocio en Firestore; revisiones actuales y observación de clientes autorizados. Ninguna referencia histórica acredita integración real.',
            'Evidencias': evidence_text(result.get('evidence'), args.output),
            'Pendiente o limitación': joined(result.get('limitation')) + (' | Incidencia: ' + joined(result['incident']) if result.get('incident') else '') + (' | Severidad: ' + joined(result['severity']) if result.get('severity') else '')}
        for label, value in values.items():
            if label in record['resultParagraphs']:
                set_text(paragraphs[record['resultParagraphs'][label]], label + ' ' + value)
    # Discard the previous campaign's executive results, evidence and account inventory.
    # This source has its immutable protocol introduction after that earlier summary.
    refresh_campaign_summary(root, paragraphs, manifest['campaign'], counts, len(records))
    set_text(paragraphs[3], f'{len(records)} casos de prueba en {len(manifest["blocks"])} bloques. Resultados nuevos de la campaña {manifest["campaign"]}; ningún resultado de campañas anteriores se conserva.')
    # Explicitly remove stale campaign-only assertion outside individual result fields.
    for p in root.findall('.//w:p', NS):
        value = text(p)
        if value.startswith('Esta copia registra exclusivamente las comprobaciones de la campaña indicada.'):
            set_text(p, 'Esta copia registra exclusivamente los resultados de la nueva campaña. Las limitaciones y simulaciones se detallan en cada ficha.')
        elif value.startswith('Total 206   APROBADO'):
            set_text(p, 'Total ' + str(len(records)) + '   ' + '   '.join(state + ' ' + str(counts[state]) for state in STATES))
        elif value.startswith('Base revisada:') and 'Referencia pública:' in value:
            set_text(p, value.replace('Base revisada:', 'Base histórica del protocolo:').replace('Referencia pública:', '\nReferencia pública:').replace('/tree/', '/tree/\n'))
        elif value.startswith('Este documento sustituye el protocolo antiguo como guía de ejecución.'):
            set_text(p, 'Este documento conserva los objetivos del protocolo y registra las comprobaciones de la nueva campaña. Las fichas distinguen resultados observados, evidencias y limitaciones; no garantizan ausencia absoluta de fallos.')
        else:
            adapted = adapt_persistence(value)
            if adapted != value:
                set_text(p, adapted)
    discard_previous_supplemental_incidents(root)
    supplemental_path = Path(args.manifest).resolve().parent / 'supplemental-incidents.json'
    if supplemental_path.exists():
        supplemental = json.loads(supplemental_path.read_text(encoding='utf-8-sig'))
        body = root.find('w:body', NS)
        incident_heading = next((p for p in body.findall('w:p', NS) if text(p) == 'Registro de incidencias y cierre'), None)
        if supplemental and incident_heading is not None:
            location = list(body).index(incident_heading) + 1
            values = [('Heading2', 'Incidencias suplementarias fuera de los ' + str(len(records)) + ' casos')]
            for extra in supplemental:
                values.extend([(None, str(extra['id']) + ' | Severidad ' + str(extra.get('severity', 'sin clasificar')) + ' | ' + str(extra.get('title', ''))),
                               (None, 'Entorno ' + joined(extra.get('environment'))),
                               (None, 'Pasos realizados ' + joined(extra.get('steps'))),
                               (None, 'Resultado observado ' + joined(extra.get('observed'))),
                               (None, 'Resultado esperado ' + joined(extra.get('expected'))),
                               (None, 'Evidencias ' + evidence_text(extra.get('evidence'), args.output)),
                               (None, 'Limitación ' + joined(extra.get('limitation') or extra.get('limitations')))])
            for style, value in values:
                p = ET.Element(W + 'p')
                if style:
                    props = ET.SubElement(p, W + 'pPr')
                    ET.SubElement(props, W + 'pStyle').set(W + 'val', style)
                set_text(p, value)
                body.insert(location, p)
                location += 1
    destination = Path(args.output)
    destination.parent.mkdir(parents=True, exist_ok=True)
    xml = ET.tostring(root, encoding='utf-8', xml_declaration=True)
    # mc:Ignorable can refer to namespace prefixes present in the source declaration
    # but unused by elements; ElementTree would otherwise drop their declarations.
    with zipfile.ZipFile(source) as source_zip:
        original_xml = source_zip.read('word/document.xml')
    declarations = dict(re.findall(rb'xmlns:([\w]+)="([^"]+)"', original_xml.split(b'>', 2)[1]))
    root_tag = xml.split(b'>', 2)[1]
    missing = b''.join(b' xmlns:' + prefix + b'="' + uri + b'"' for prefix, uri in declarations.items() if b'xmlns:' + prefix + b'=' not in root_tag)
    if missing:
        offset = xml.find(b'>', xml.find(b'?>') + 2)
        xml = xml[:offset] + missing + xml[offset:]
    with zipfile.ZipFile(source) as source_zip, zipfile.ZipFile(destination, 'w', zipfile.ZIP_DEFLATED) as output:
        for item in source_zip.infolist():
            output.writestr(item, xml if item.filename == 'word/document.xml' else source_zip.read(item.filename))
    print(json.dumps({'output': str(destination), 'counts': dict(counts), 'missing': len(records) - len(results)}, ensure_ascii=False))

def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest='command', required=True)
    p = sub.add_parser('extract')
    p.add_argument('--source', required=True)
    p.add_argument('--campaign', required=True)
    p.add_argument('--output', required=True)
    p.set_defaults(fn=extract)
    p = sub.add_parser('fill')
    p.add_argument('--manifest', required=True)
    p.add_argument('--results', required=True)
    p.add_argument('--output', required=True)
    p.set_defaults(fn=fill)
    args = parser.parse_args()
    args.fn(args)

if __name__ == '__main__':
    main()
