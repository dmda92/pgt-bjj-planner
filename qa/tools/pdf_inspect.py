"""Inspect downloaded QA PDFs without storing authentication material."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / '.qa' / 'python-deps'))
from pypdf import PdfReader

reader = PdfReader(sys.argv[1])
rows = []
for index, page in enumerate(reader.pages):
    resources = page.get('/Resources', {})
    if hasattr(resources, 'get_object'):
        resources = resources.get_object()
    images = 0
    for value in resources.get('/XObject', {}).get_object().values() if hasattr(resources.get('/XObject', {}), 'get_object') else resources.get('/XObject', {}).values():
        if value.get_object().get('/Subtype') == '/Image':
            images += 1
    rows.append({'number': index + 1, 'text': page.extract_text(), 'images': images,
                 'width': float(page.mediabox.width), 'height': float(page.mediabox.height)})
# ASCII JSON travels safely through Windows pipes regardless of its OEM codepage.
print(json.dumps({'pages': rows, 'text': '\n'.join(row['text'] or '' for row in rows)}, ensure_ascii=True))
