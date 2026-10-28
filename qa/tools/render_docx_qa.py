"""Render with the Documents skill converter and QA-isolated LibreOffice.

Windows QA lacks Poppler: PyMuPDF rasterizes the exact Writer-produced PDF.
The source converter, profile isolation and page-size logic remain unchanged.
"""
import argparse
import importlib.util
import json
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('input')
    parser.add_argument('--output', required=True)
    parser.add_argument('--soffice', required=True, help='Absolute QA-isolated soffice.exe path, never desktop installation')
    parser.add_argument('--skill-renderer', required=True)
    parser.add_argument('--dpi', type=int, default=144)
    args = parser.parse_args()
    soffice = Path(args.soffice).resolve(strict=True)
    allowed = Path('.qa/tools/lo-extracted/program/soffice.exe').resolve()
    if soffice != allowed:
        raise ValueError('Only the verified QA-isolated LibreOffice executable is allowed')
    import pymupdf as fitz
    spec = importlib.util.spec_from_file_location('skill_render_docx', Path(args.skill_renderer).resolve(strict=True))
    renderer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(renderer)
    renderer._resolve_soffice = lambda: str(soffice)

    def raster_pdf(pdf_path, *, dpi, output_folder, **kwargs):
        files = []
        with fitz.open(pdf_path) as doc:
            for index, page in enumerate(doc):
                path = Path(output_folder) / f'page0001-{index + 1:04d}.png'
                page.get_pixmap(dpi=dpi, alpha=False).save(str(path))
                files.append(str(path))
        return files

    renderer.convert_from_path = raster_pdf
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    prepared, repair = renderer.make_renderable_docx_copy(str(Path(args.input).resolve()), verbose=True)
    try:
        pages = renderer.rasterize(prepared, str(output), args.dpi, verbose=True, emit_pdf=True)
    finally:
        if repair is not None:
            repair.cleanup()
    audit = {'input': str(Path(args.input).resolve()), 'soffice': str(soffice),
             'skillRenderer': str(Path(args.skill_renderer).resolve()), 'rasterizer': 'PyMuPDF',
             'dpi': args.dpi, 'pages': len(pages), 'pagePaths': pages,
             'scope': 'Real DOCX layout via private Writer engine; PyMuPDF replaces missing Poppler only.'}
    (output / 'render-audit.json').write_text(json.dumps(audit, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'renderedPages': len(pages), 'output': str(output)}))


if __name__ == '__main__':
    main()
