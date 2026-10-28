"""Redact shareable QA artifacts without reading or changing browser profiles.

Private credentials are read locally to identify exact secrets. Only paths explicitly
passed with --artifacts are changed. Passwords, token values and private file contents
are never logged. ZIP entry names/hashes stay unchanged for Playwright trace loading.
"""
import argparse
import base64
import io
import json
import os
import re
import zipfile
from pathlib import Path
from urllib.parse import quote, quote_plus

SENSITIVE = re.compile(r'(?i)^(?:password|pwd|passwd|contrase(?:ñ|n)a|token|accessToken|refreshToken|idToken|ticket|secret|authorization|cookie|set-cookie|cookies|sessionToken|sessionCookie)$')
TEXT_EXTENSIONS = {'.json', '.jsonl', '.html', '.htm', '.md', '.txt', '.log', '.trace', '.network', '.har', '.yaml', '.yml', '.xml'}
JSON_SECRET = re.compile(r'(?i)("(?:password|pwd|passwd|contrase(?:ñ|n)a|token|accessToken|refreshToken|idToken|ticket|secret|authorization|cookie|set-cookie|sessionToken)"\s*:\s*)"(?:\\.|[^"\\])*"')
BEARER = re.compile(r'(?i)\bBearer\s+[A-Za-z0-9._~+/-]+={0,2}')
QUERY_SECRET = re.compile(r'(?i)([?&](?:token|ticket|password|secret|session)=)[^&#\s"<>]+')
EMBEDDED_ZIP = re.compile(r'(data:application/zip;base64,)([A-Za-z0-9+/=\r\n]+)')
EXCLUDED_DIRECTORIES = {'profile', 'browser-state', 'storage-state', 'state', 'node_modules'}


def artifact_files(path):
    if not path.is_dir():
        yield path
        return
    for directory, subdirectories, filenames in os.walk(path):
        subdirectories[:] = [name for name in subdirectories if name.lower() not in EXCLUDED_DIRECTORIES and not name.lower().startswith('profiles')]
        for filename in filenames:
            yield Path(directory) / filename


def collect_secrets(value, output, sensitive=False):
    if isinstance(value, dict):
        if isinstance(value.get('name'), str) and SENSITIVE.fullmatch(value['name']) and 'value' in value:
            collect_secrets(value['value'], output, True)
        for key, item in value.items():
            collect_secrets(item, output, sensitive or bool(SENSITIVE.fullmatch(key)))
    elif isinstance(value, list):
        for item in value:
            collect_secrets(item, output, sensitive)
    elif sensitive and isinstance(value, str) and len(value) >= 4:
        output.add(value)


def redact_json(value):
    if isinstance(value, dict):
        if isinstance(value.get('name'), str) and SENSITIVE.fullmatch(value['name']) and 'value' in value:
            return {key: '[REDACTADO]' if key == 'value' else redact_json(item) for key, item in value.items()}
        return {key: '[REDACTADO]' if SENSITIVE.fullmatch(key) else redact_json(item) for key, item in value.items()}
    if isinstance(value, list):
        return [redact_json(item) for item in value]
    if isinstance(value, str):
        if value.lstrip().startswith(('{', '[')):
            try:
                nested = json.loads(value)
            except (ValueError, TypeError):
                pass
            else:
                if isinstance(nested, (dict, list)):
                    return json.dumps(redact_json(nested), ensure_ascii=False, separators=(',', ':'))
        return redact_text(value, set(), parse_json=False)
    return value


def redact_text(value, secrets, parse_json=True):
    for secret in sorted(secrets, key=len, reverse=True):
        for variant in {secret, json.dumps(secret, ensure_ascii=False)[1:-1], quote(secret, safe=''), quote_plus(secret)}:
            value = value.replace(variant, '[REDACTADO]')
    value = BEARER.sub('Bearer [REDACTADO]', value)
    value = QUERY_SECRET.sub(r'\1[REDACTADO]', value)
    value = JSON_SECRET.sub(r'\1"[REDACTADO]"', value)
    if parse_json:
        try:
            parsed = json.loads(value)
        except (ValueError, TypeError):
            pass
        else:
            if '\n' in value.rstrip('\r\n'):
                return json.dumps(redact_json(parsed), ensure_ascii=False, indent=2) + '\n'
            return json.dumps(redact_json(parsed), ensure_ascii=False, separators=(',', ':')) + ('\n' if value.endswith('\n') else '')
        lines = value.splitlines(keepends=True)
        out = []
        for line in lines:
            try:
                parsed = json.loads(line)
            except (ValueError, TypeError):
                out.append(line)
            else:
                out.append(json.dumps(redact_json(parsed), ensure_ascii=False, separators=(',', ':')) + ('\n' if line.endswith('\n') else ''))
        value = ''.join(out)
    return value


def transform_bytes(data, secrets, depth=0):
    if depth > 8:
        raise ValueError('Artifact nesting exceeds eight levels; manual privacy review required')
    if data.startswith(b'PK\x03\x04') and zipfile.is_zipfile(io.BytesIO(data)):
        return transform_archive(data, secrets, depth + 1)
    try:
        decoded = data.decode('utf-8-sig')
    except UnicodeDecodeError:
        return data
    # Binary files that happen to decode should never be rewritten.
    if '\x00' in decoded:
        return data
    original_decoded = decoded
    def embedded(match):
        original = base64.b64decode(match[2])
        revised = transform_bytes(original, secrets, depth + 1)
        return match[1] + base64.b64encode(revised).decode('ascii') if revised != original else match[0]
    decoded = EMBEDDED_ZIP.sub(embedded, decoded)
    transformed = redact_text(decoded, secrets)
    return transformed.encode('utf-8') if transformed != original_decoded else data


def transform_archive(data, secrets, depth=0):
    entries = []
    changed = False
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        for info in archive.infolist():
            raw = archive.read(info.filename)
            revised = raw if info.is_dir() or info.filename.lower().endswith(('.png', '.jpg', '.jpeg', '.webp', '.woff', '.woff2', '.ttf', '.pdf')) else transform_bytes(raw, secrets, depth + 1)
            changed = changed or revised != raw
            entries.append((info, revised))
    if not changed:
        return data
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        for info, revised in entries:
            archive.writestr(info, revised)
    return output.getvalue()


def discover(data, secrets, depth=0):
    if depth > 8:
        raise ValueError('Artifact nesting exceeds eight levels; manual privacy review required')
    if data.startswith(b'PK\x03\x04') and zipfile.is_zipfile(io.BytesIO(data)):
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            for item in archive.infolist():
                if not item.is_dir() and not item.filename.lower().endswith(('.png', '.jpg', '.jpeg', '.webp', '.pdf')):
                    discover(archive.read(item.filename), secrets, depth + 1)
        return
    try:
        value = data.decode('utf-8-sig')
    except UnicodeDecodeError:
        return
    for match in EMBEDDED_ZIP.finditer(value):
        discover(base64.b64decode(match[2]), secrets, depth + 1)
    try:
        collect_secrets(json.loads(value), secrets)
    except (ValueError, TypeError):
        for line in value.splitlines():
            try:
                collect_secrets(json.loads(line), secrets)
            except (ValueError, TypeError):
                pass
    for match in re.finditer(r'(?i)\bBearer\s+([A-Za-z0-9._~+/-]+={0,2})', value):
        if len(match[1]) >= 8:
            secrets.add(match[1])
    for match in re.finditer(r'(?i)"(?:password|pwd|token|ticket|secret|accessToken|refreshToken|idToken)"\s*:\s*("(?:\\.|[^"\\])*")', value):
        try:
            item = json.loads(match[1])
            if len(item) >= 4 and item != '[REDACTADO]':
                secrets.add(item)
        except ValueError:
            pass


def sanitize(path, secrets, check):
    before = path.read_bytes()
    if path.suffix.lower() in {'.zip', '.docx'}:
        entries = []
        changed = False
        with zipfile.ZipFile(path) as source:
            for info in source.infolist():
                data = source.read(info.filename)
                if not info.is_dir() and not info.filename.lower().endswith(('.png', '.jpg', '.jpeg', '.webp', '.woff', '.woff2', '.ttf', '.pdf')):
                    revised = transform_bytes(data, secrets)
                else:
                    revised = data
                changed = changed or data != revised
                entries.append((info, revised))
        if changed and not check:
            temporary = path.with_suffix(path.suffix + '.sanitizing')
            with zipfile.ZipFile(temporary, 'w', zipfile.ZIP_DEFLATED) as target:
                for info, data in entries:
                    target.writestr(info, data)
            temporary.replace(path)
        return changed
    after = transform_bytes(before, secrets)
    if after != before and not check:
        path.write_bytes(after)
    return after != before


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--artifacts', required=True, nargs='+', help='Explicit artifact directories/files only; never browser state/profiles')
    parser.add_argument('--secret-file', action='append', default=[])
    parser.add_argument('--check', action='store_true', help='Report count of artifacts requiring redaction without changing them')
    args = parser.parse_args()
    secrets = set()
    private_paths = set()
    for filename in args.secret_file:
        path = Path(filename).resolve()
        private_paths.add(path)
        if path.exists():
            collect_secrets(json.loads(path.read_text(encoding='utf-8-sig')), secrets)
    candidates = set()
    for filename in args.artifacts:
        path = Path(filename).resolve()
        for candidate in artifact_files(path):
            if not candidate.is_file() or candidate.resolve() in private_paths:
                continue
            if any(part.lower() in EXCLUDED_DIRECTORIES or part.lower().startswith('profiles') for part in candidate.parts):
                continue
            if '.private.' in candidate.name or '.local.' in candidate.name:
                continue
            if candidate.suffix.lower() in TEXT_EXTENSIONS | {'.zip', '.docx'}:
                candidates.add(candidate)
    # Discover session values in captured network JSON before redacting the same
    # values in otherwise unlabeled response bodies or query URLs.
    for path in sorted(candidates):
        if path.suffix.lower() in {'.zip', '.docx'}:
            with zipfile.ZipFile(path) as archive:
                for item in archive.infolist():
                    if not item.is_dir() and not item.filename.lower().endswith(('.png', '.jpg', '.jpeg', '.webp', '.pdf')):
                        discover(archive.read(item.filename), secrets)
        else:
            discover(path.read_bytes(), secrets)
    changed = sum(sanitize(path, secrets, args.check) for path in sorted(candidates))
    print(json.dumps({'checkedArtifacts': len(candidates), 'artifactsRequiringRedaction' if args.check else 'redactedArtifacts': changed, 'mode': 'check' if args.check else 'sanitize'}))
    if args.check and changed:
        raise SystemExit(2)


if __name__ == '__main__':
    main()
