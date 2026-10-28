import base64
import io
import json
import unittest
import zipfile

import sanitize_artifacts as sanitizer


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


if __name__ == '__main__':
    unittest.main()
