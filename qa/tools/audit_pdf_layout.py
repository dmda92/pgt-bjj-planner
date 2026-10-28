"""Audit every rendered PDF page and build numbered contact sheets for review.

Geometry checks do not replace opening page PNGs at readable resolution.
"""
import argparse
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('pdf')
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    import pymupdf
    from PIL import Image, ImageDraw
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    pages = []
    problems = []
    thumbs = []
    with pymupdf.open(args.pdf) as pdf:
        for index, page in enumerate(pdf):
            words = page.get_text('words')
            outside = [w[:4] for w in words if w[0] < -1 or w[1] < -1 or w[2] > page.rect.width + 1 or w[3] > page.rect.height + 1]
            margins = [w[:4] for w in words if w[0] < 35 or w[2] > page.rect.width - 35]
            missing = page.get_text().count('\ufffd')
            record = {'page': index + 1, 'words': len(words), 'outsidePage': len(outside), 'replacementGlyphs': missing, 'marginSpill': len(margins)}
            pages.append(record)
            if outside or margins or missing or len(words) < 3:
                problems.append({**record, 'outsideBoxes': outside, 'marginBoxes': margins})
            pix = page.get_pixmap(matrix=pymupdf.Matrix(0.5, 0.5), alpha=False)
            thumbnail = Image.frombytes('RGB', (pix.width, pix.height), pix.samples)
            thumbnail.thumbnail((310, 420))
            thumbs.append(thumbnail)
    for start in range(0, len(thumbs), 20):
        sheet = Image.new('RGB', (1600, 1840), '#d5dbe2')
        draw = ImageDraw.Draw(sheet)
        for offset, thumb in enumerate(thumbs[start:start + 20]):
            x, y = (offset % 5) * 320, (offset // 5) * 460
            sheet.paste(thumb, (x + (320 - thumb.width) // 2, y + 26))
            draw.text((x + 12, y + 7), f'Page {start + offset + 1}', fill='black')
        sheet.save(output / f'contact-{start // 20 + 1:03d}.png')
    audit = {'pdf': str(Path(args.pdf).resolve()), 'pages': pages, 'problems': problems,
             'scope': 'All pages checked for out-of-page word geometry and replacement glyphs; manual page-image review remains separate.'}
    (output / 'layout-audit.json').write_text(json.dumps(audit, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'pages': len(pages), 'flaggedPages': len(problems)}))


if __name__ == '__main__':
    main()
