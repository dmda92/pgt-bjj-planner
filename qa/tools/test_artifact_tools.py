import base64
import io
import json
import unittest
import zipfile
import hashlib
from pathlib import Path
from collections import Counter
from xml.etree import ElementTree as ET
from tempfile import TemporaryDirectory
from argparse import Namespace

import sanitize_artifacts as sanitizer
import protocol_docx as protocol


def archive(name, data):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w') as output:
        output.writestr(name, data)
    return buffer.getvalue()


class ArtifactPrivacyTests(unittest.TestCase):
    def test_nested_trace_zip_inside_embedded_html_report_is_redacted(self):
        secret = 'Synthetic-Nested-Secret-2026'
        inner = archive('event.trace', json.dumps({'authorization': 'Bearer ' + secret}) + '\n')
        outer = archive('resources/trace.zip', inner)
        source = ('<script>window.playwrightReportBase64="data:application/zip;base64,' +
                  base64.b64encode(outer).decode() + '"</script>').encode()
        secrets = set()
        sanitizer.discover(source, secrets)
        self.assertIn(secret, secrets)
        result = sanitizer.transform_bytes(source, secrets)
        self.assertNotEqual(source, result)
        self.assertEqual(result, sanitizer.transform_bytes(result, secrets))
        embedded = base64.b64decode(sanitizer.EMBEDDED_ZIP.search(result.decode())[2])
        with zipfile.ZipFile(io.BytesIO(embedded)) as container:
            with zipfile.ZipFile(io.BytesIO(container.read('resources/trace.zip'))) as trace:
                event = trace.read('event.trace')
        self.assertNotIn(secret.encode(), event)
        self.assertIn(b'[REDACTADO]', event)
        self.assertEqual(len(event.splitlines()), 1)

    def test_nested_post_data_and_cookie_values_do_not_survive(self):
        source = json.dumps({'postData': {'text': json.dumps({'password': 'synthetic-private-value'})},
                             'cookies': [{'name': 'session', 'value': 'synthetic-cookie'}],
                             'headers': [{'name': 'Cookie', 'value': 'synthetic-cookie-header'}]})
        result = sanitizer.redact_text(source, set())
        self.assertNotIn('synthetic-private-value', result)
        self.assertNotIn('synthetic-cookie', result)
        self.assertNotIn('synthetic-cookie-header', result)
        self.assertEqual(result, sanitizer.redact_text(result, set()))


class CampaignSummaryTests(unittest.TestCase):
    def document(self, heading, introduction):
        root = ET.Element(protocol.W + 'document')
        body = ET.SubElement(root, protocol.W + 'body')
        for value in [heading, 'APROBADO: 170, FALLIDO: 15', 'Ejecución completa: 89.81%', 'Old campaign account inventory']:
            p = ET.SubElement(body, protocol.W + 'p'); protocol.set_text(p, value)
        table = ET.SubElement(body, protocol.W + 'tbl')
        p = ET.SubElement(table, protocol.W + 'p'); protocol.set_text(p, 'Old account table')
        p = ET.SubElement(body, protocol.W + 'p'); protocol.set_text(p, introduction)
        return root, body.findall(protocol.W + 'p')

    def test_both_summary_formats_discard_previous_results_and_inventories(self):
        for heading, intro in [('Resultados de la campaña del 26/10/2026', 'Este documento sustituye el protocolo antiguo'), ('Resultados de la campaña 2026-10-26', 'Este documento conserva los objetivos del protocolo')]:
            with self.subTest(heading=heading):
                root, paragraphs = self.document(heading, intro)
                protocol.refresh_campaign_summary(root, paragraphs, 'new-campaign', Counter(APROBADO=1, FALLIDO=1), 4)
                value = protocol.text(root)
                for wanted in ['Resultados de la campaña new-campaign', 'APROBADO: 1, FALLIDO: 1', 'Ejecución completa: 50.00%', 'Aprobación sobre ejecución completa: 50.00%']:
                    self.assertIn(wanted, value)
                for stale in ['170', '89.81%', 'Old account', 'Old campaign']:
                    self.assertNotIn(stale, value)

    def test_unrecognized_boundary_fails_instead_of_leaking_stale_results(self):
        root, paragraphs = self.document('Resultados de la campaña 2026-10-26', 'Unknown introduction')
        with self.assertRaisesRegex(ValueError, 'Cannot safely locate'):
            protocol.refresh_campaign_summary(root, paragraphs, 'new', Counter(), 206)

    def test_current_source_keeps_all_case_criteria_and_original_bytes(self):
        manifest_path = Path('.qa/campaigns/2026-10-28-dev-rerun/manifest.json')
        if not manifest_path.exists():
            self.skipTest('Campaign source is only available on the QA workstation')
        manifest = json.loads(manifest_path.read_text(encoding='utf-8-sig'))
        source = Path(manifest['source']); digest = hashlib.sha256(source.read_bytes()).hexdigest()
        self.assertEqual(digest, manifest['sourceSha256'])
        root = protocol.read_source(source); records, paragraphs = protocol.cases(root)
        criteria = [(r['id'], r['title'], r['steps'], r['expected']) for r in records]
        self.assertEqual(206, len(criteria))
        protocol.refresh_campaign_summary(root, paragraphs, 'new-independent-campaign', Counter(APROBADO=2), 206)
        current, _ = protocol.cases(root)
        self.assertEqual(criteria, [(r['id'], r['title'], r['steps'], r['expected']) for r in current])
        self.assertNotIn('APROBADO: 170, FALLIDO: 15', protocol.text(root))
        self.assertEqual(digest, hashlib.sha256(source.read_bytes()).hexdigest())

    def test_filling_current_source_does_not_inherit_old_supplemental_incident(self):
        manifest_path = Path('.qa/campaigns/2026-10-28-dev-rerun/manifest.json')
        if not manifest_path.exists():
            self.skipTest('Campaign source is only available on the QA workstation')
        manifest = json.loads(manifest_path.read_text(encoding='utf-8-sig'))
        source = Path(manifest['source']); digest = hashlib.sha256(source.read_bytes()).hexdigest()
        original, _ = protocol.cases(protocol.read_source(source))
        self.assertIn('QA-CONTENT-BLOCK-REUSE | Severidad ALTA', protocol.text(protocol.read_source(source)))
        with TemporaryDirectory(prefix='pgt-qa-docx-regression-') as directory:
            output = Path(directory) / 'fresh-results.docx'
            protocol.fill(Namespace(manifest=str(manifest_path), results=str(manifest_path.parent / 'results'), output=str(output)))
            root = protocol.read_source(output); current, _ = protocol.cases(root)
            self.assertFalse('QA-CONTENT-BLOCK-REUSE | Severidad ALTA' in protocol.text(root), 'Previous supplemental CAS result leaked into new campaign')
            self.assertFalse('2026-10-26T21-10-24-691Z' in protocol.text(root), 'Previous supplemental evidence leaked into new campaign')
            self.assertEqual([(r['id'], r['steps'], r['expected']) for r in original], [(r['id'], r['steps'], r['expected']) for r in current])
            self.assertIn('ID de incidencia ________________________', protocol.text(root))
        self.assertEqual(digest, hashlib.sha256(source.read_bytes()).hexdigest())


if __name__ == '__main__':
    unittest.main()
