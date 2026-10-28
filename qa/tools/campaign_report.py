"""Build campaign summaries from individual, evidence-backed case result files."""
import argparse
import html
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from protocol_docx import STATES, adapt_persistence, joined


def load_campaign(root):
    manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8-sig'))
    results = {}
    for path in sorted((root / 'results').glob('*.json')):
        row = json.loads(path.read_text(encoding='utf-8-sig'))
        if row['id'] in results or row['status'] not in STATES:
            raise ValueError('Duplicate ID or invalid status: ' + str(path))
        results[row['id']] = row
    cases = []
    valid = {c['id'] for c in manifest['cases']}
    if set(results) - valid:
        raise ValueError('Unknown result identifiers')
    for case in manifest['cases']:
        result = results.get(case['id'], {'id': case['id'], 'status': 'NO EJECUTADO',
                                         'limitation': 'Sin registro de ejecución en esta campaña.'})
        cases.append({**case, **result, 'protocolSteps': case['steps'], 'protocolExpected': case['expected']})
    return manifest, cases


def markdown(value):
    return adapt_persistence(joined(value)).replace('|', '\\|').replace('\n', '<br>')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--campaign', required=True)
    args = parser.parse_args()
    root = Path(args.campaign).resolve()
    manifest, cases = load_campaign(root)
    reports = root / 'reports'
    reports.mkdir(exist_ok=True)
    render_audit_path = reports / 'document-render' / 'render-audit.json'
    render_audit = json.loads(render_audit_path.read_text(encoding='utf-8-sig')) if render_audit_path.exists() else None
    runtime_path = root / 'runtime-final.json'
    runtime = json.loads(runtime_path.read_text(encoding='utf-8-sig')) if runtime_path.exists() else None
    render_statement = ('DOCX renderizado con LibreOffice privado de QA y rasterización PyMuPDF; ' + str(render_audit['pages']) + ' páginas. La revisión visual se registra por separado.'
                        if render_audit else 'El DOCX final aún no tiene render registrado. La revisión HTML no acredita paginación ni fidelidad de Word.')
    counts = Counter(c['status'] for c in cases)
    complete = counts['APROBADO'] + counts['FALLIDO']
    metrics = {'total': len(cases), 'counts': {s: counts[s] for s in STATES},
               'complete': complete, 'completePercent': round(100 * complete / len(cases), 2),
               'approvalOfCompletePercent': round(100 * counts['APROBADO'] / complete, 2) if complete else None}
    environments = {}
    for case in cases:
        environment = joined(case.get('environment')) or 'Sin entorno de ejecución registrado'
        environments.setdefault(environment, Counter())[case['status']] += 1
    metrics['environments'] = {name: dict(values) for name, values in environments.items()}
    missing_evidence = []
    incomplete_records = []
    missing_users = []
    incidents = []
    supplemental_path = root / 'supplemental-incidents.json'
    supplemental = json.loads(supplemental_path.read_text(encoding='utf-8-sig')) if supplemental_path.exists() else []
    if not isinstance(supplemental, list):
        raise ValueError('supplemental-incidents.json must contain an array')
    for case in cases:
        if case['status'] in {'APROBADO', 'FALLIDO', 'PARCIAL'} and not case.get('users'):
            missing_users.append(case['id'])
        evidence = case.get('evidence', [])
        if isinstance(evidence, str):
            evidence = [evidence] if evidence else []
        for reference in evidence:
            candidate = Path(reference)
            if not candidate.is_absolute():
                candidate = root / candidate
            if not candidate.exists():
                missing_evidence.append({'id': case['id'], 'reference': reference})
        if case['status'] == 'APROBADO' and (not case.get('observed') or not case.get('steps') or not evidence):
            incomplete_records.append({'id': case['id'], 'reason': 'APROBADO exige pasos, resultado observado y evidencia.'})
        if case.get('incident') or case['status'] == 'FALLIDO':
            incidents.append({k: case.get(k, '') for k in ['id', 'title', 'status', 'priority', 'severity', 'incidentFamily', 'issueGroup', 'incident', 'observed', 'expected', 'steps', 'environment', 'evidence', 'limitation']})
    for extra in supplemental:
        incident = {k: extra.get(k, '') for k in ['id', 'title', 'status', 'priority', 'severity', 'incidentFamily', 'incident', 'observed', 'expected', 'steps', 'environment', 'evidence', 'limitation']}
        incident['scope'] = 'SUPLEMENTARIO FUERA DEL PROTOCOLO'
        incident['incident'] = incident['incident'] or incident['id']
        incident['incidentFamily'] = incident['incidentFamily'] or extra.get('issueGroup', '')
        incident['limitation'] = incident['limitation'] or extra.get('limitations', '')
        incidents.append(incident)
        for reference in extra.get('evidence', []):
            candidate = Path(reference)
            if not candidate.is_absolute():
                candidate = root / candidate
            if not candidate.exists():
                missing_evidence.append({'id': incident['id'], 'reference': reference})
    families = {}
    for incident in incidents:
        key = str(incident.get('incidentFamily') or incident.get('issueGroup') or incident.get('incident') or incident['id'])
        family = families.setdefault(key, {'id': key, 'cases': [], 'severities': []})
        family['cases'].append(incident['id'])
        if incident['severity']:
            family['severities'].append(str(incident['severity']).upper())
    for family in families.values():
        values = set(family['severities'])
        family['severity'] = next(iter(values)) if len(values) == 1 else 'SIN CLASIFICAR' if not values else 'REQUIERE TRIAGE'
    severity = Counter(c['severity'] for c in families.values())
    metrics['incidentSeverity'] = dict(severity)
    metrics['incidentCaseRecords'] = len(incidents)
    metrics['incidentFamilies'] = len(families)
    metrics['supplementalIncidents'] = len(supplemental)
    audit = {'generatedAt': datetime.now(timezone.utc).isoformat(), 'metrics': metrics,
             'missingEvidence': missing_evidence, 'incompleteApprovals': incomplete_records, 'missingUserIds': missing_users,
             'rendering': render_statement}
    (reports / 'audit.json').write_text(json.dumps(audit, ensure_ascii=False, indent=2), encoding='utf-8')
    (reports / 'incidents.json').write_text(json.dumps(incidents, ensure_ascii=False, indent=2), encoding='utf-8')
    (reports / 'incident-families.json').write_text(json.dumps(list(families.values()), ensure_ascii=False, indent=2), encoding='utf-8')
    rows = ['# Resultado de QA PGT BJJ Planner', '', f'Campaña {manifest["campaign"]}. {len(cases)} casos originales; estados reconstruidos desde resultados nuevos.', '']
    if runtime:
        rows.extend(['Versión DEV verificada: `' + str(runtime.get('build')) + '`; coordinador `' + str(runtime.get('domainBuild')) + '`; proyecto `' + str(runtime.get('project')) + '`; revisión `' + str(runtime.get('revision')) + '`.', '',
                     'Evidencia de identidad: `../runtime-final.json`. No se desplegó ni modificó producción durante la campaña.', ''])
    rows.extend(['| Estado | Casos |', '|---|---:|'])
    rows.extend(f'| {s} | {counts[s]} |' for s in STATES)
    rows.extend(['', f'Ejecución completa: **{metrics["completePercent"]:.2f}%** ({complete}/{len(cases)}; solo APROBADO y FALLIDO).',
                 'Aprobación sobre ejecución completa: **' + (f'{metrics["approvalOfCompletePercent"]:.2f}%' if complete else 'no calculable') + '**.', '',
                 'Los casos PARCIAL, BLOQUEADO, NO APLICA y NO EJECUTADO no cuentan como aprobados ni como ejecución completa.', '',
                 '| Entorno declarado | APROBADO | FALLIDO | PARCIAL | Otros estados |', '|---|---:|---:|---:|---:|'])
    rows.extend(f'| {markdown(name)} | {values["APROBADO"]} | {values["FALLIDO"]} | {values["PARCIAL"]} | {sum(values.values()) - values["APROBADO"] - values["FALLIDO"] - values["PARCIAL"]} |' for name, values in environments.items())
    rows.extend(['', 'Las aprobaciones locales o simuladas solo acreditan el entorno declarado; no se presentan como comprobaciones de Firestore DEV real.', '',
                 '| Caso | Estado | Entorno | Limitación o incidencia |', '|---|---|---|---|'])
    rows.extend(f'| {c["id"]} | {c["status"]} | {markdown(c.get("environment"))} | {markdown(c.get("incident") or c.get("limitation"))} |' for c in cases)
    rows.extend(['', '## Incidencias y revisión manual', '',
                 'Incidencias críticas: ' + str(severity['CRÍTICA'] + severity['CRITICA']) + '. Incidencias altas: ' + str(severity['ALTA']) + '. Severidad sin clasificar: ' + str(severity['SIN CLASIFICAR']) + '.', '',
                 str(len(families)) + ' familias de incidencia en ' + str(len(incidents)) + ' fichas; solo se agrupan cuando existe una familia o identificador explícito.', '',
                 str(len(supplemental)) + ' incidencias suplementarias documentadas fuera del protocolo; no incrementan los ' + str(len(cases)) + ' casos ni sus porcentajes.', '',
                 'La prioridad del caso y la severidad de una incidencia son atributos distintos. No se asigna severidad por inferencia automática.', '',
                 'Requieren revisión de una persona o infraestructura adicional los casos bloqueados y los criterios pendientes identificados en la tabla; no se considera intervención manual necesaria lo que ya puede ejecutar la automatización autorizada.', '',
                 '## Aceptación', '',
                 ('Recomendación: RECHAZAR la aceptación de la versión en esta campaña; hay fallos o criterios sin ejecución completa.' if counts['FALLIDO'] or counts['PARCIAL'] or counts['BLOQUEADO'] or counts['NO EJECUTADO'] else 'Recomendación: revisar las evidencias y excepciones de NO APLICA antes de aceptar la versión.'), '',
                 'No se recomienda aceptar la versión mientras existan fallos críticos o altos sin excepción aprobada, o criterios críticos sin ejecutar completamente. La campaña no acredita compatibilidad con dispositivos físicos, Android o Safari iOS salvo evidencia específica.', '',
                 '## Integridad y limitaciones', '',
                 'Cada ficha distingue DEV real de simulación o inspección. Las observaciones por API autorizada acreditan el estado entregado por el backend y no equivalen por sí solas a una inspección directa de Firestore.', '',
                 f'Referencias de evidencia ausentes: {len(missing_evidence)}. Aprobaciones con registro incompleto: {len(incomplete_records)}.', '',
                 render_statement + ' No se usa el LibreOffice de escritorio del usuario.'])
    (reports / 'executive-summary.md').write_text('\n'.join(rows) + '\n', encoding='utf-8')
    incident_lines = ['# Inventario de incidencias', '', f'{len(incidents)} fichas con fallo o incidencia registrada.', '']
    for incident in incidents:
        incident_lines.extend([f'## {incident["id"]} {incident["title"]}', '',
                               'Alcance: ' + incident.get('scope', 'Caso del protocolo'), '',
                               'Prioridad del caso: ' + markdown(incident['priority']), '',
                               'Severidad de la incidencia: ' + markdown(incident['severity'] or 'SIN CLASIFICAR'), '',
                               'Familia: ' + markdown(incident['incidentFamily'] or incident.get('issueGroup')), '',
                               'Incidencia: ' + markdown(incident['incident']), '',
                               'Pasos: ' + markdown(incident['steps']), '',
                               'Esperado: ' + markdown(incident['expected']), '',
                               'Observado: ' + markdown(incident['observed']), '',
                               'Evidencias: ' + markdown(incident['evidence']), '',
                               'Limitaciones: ' + markdown(incident['limitation']), ''])
    (reports / 'incidents.md').write_text('\n'.join(incident_lines), encoding='utf-8')
    # Static report uses no scripts, credentials or network resources.
    chunks = ['<!doctype html><html lang="es"><meta charset="utf-8"><title>Resultados QA PGT</title>',
              '<style>body{font:16px Arial,sans-serif;max-width:960px;margin:40px auto;padding:0 24px;color:#172536}section{border:1px solid #ccd3db;border-radius:8px;margin:24px 0;padding:20px;break-inside:avoid}h1,h2{line-height:1.25}dt{font-weight:bold;margin-top:12px}dd{margin:4px 0;white-space:pre-wrap;overflow-wrap:anywhere}small{color:#475569}@media print{section{break-inside:auto}}</style>',
              '<h1>Resultados QA PGT BJJ Planner</h1><p>' + html.escape(manifest['campaign']) + '</p>',
              '<p>' + html.escape(json.dumps(metrics, ensure_ascii=False)) + '</p>']
    for case in cases:
        chunks.append('<section id="' + case['id'].replace(' ', '-') + '"><h2>' + html.escape(case['id'] + ' ' + case['title']) + '</h2><dl>')
        for label, key in [('Estado', 'status'), ('Prioridad', 'priority'), ('Pasos originales adaptados', 'protocolSteps'), ('Resultado esperado íntegro', 'protocolExpected'), ('Pasos ejecutados', 'steps'),
                           ('Fecha', 'executedAt'), ('Entorno', 'environment'), ('Usuarios', 'users'), ('Alcance de las sesiones', 'userMetadataNote'), ('Observado', 'observed'),
                           ('Evidencias', 'evidence'), ('Incidencia', 'incident'), ('Limitación', 'limitation'), ('Adaptación', 'adaptation')]:
            value = adapt_persistence(joined(case.get(key)))
            chunks.append('<dt>' + label + '</dt><dd>' + html.escape(value) + '</dd>')
        chunks.append('</dl></section>')
    chunks.append('</html>')
    (reports / 'case-results.html').write_text('\n'.join(chunks), encoding='utf-8')
    print(json.dumps({'metrics': metrics, 'missingEvidence': len(missing_evidence), 'incompleteApprovals': len(incomplete_records)}))


if __name__ == '__main__':
    main()
