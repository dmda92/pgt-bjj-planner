import { createHash } from 'node:crypto';
import { normalizedMail } from '../../worker/security.ts';
export const SOURCE_REPOSITORY = 'dmda92/pgt-bjj-data' as const;
export type SourceFile = {
    path: string;
    blob: string;
    bytes: number;
    content: string;
};
export interface GithubSnapshot {
    format: 'pgt-github-source-v1';
    repository: typeof SOURCE_REPOSITORY;
    commit: string;
    tree: string;
    capturedAt: string;
    files: SourceFile[];
    checksum: string;
}
export type SourceTransport = (url: string, init: RequestInit) => Promise<Response>;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const blobSha = (content: string) => { const bytes = Buffer.from(content, 'utf8'); return createHash('sha1').update(Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex'); };
const sha = (value: string) => { if (!/^[0-9a-f]{40}$/.test(value))
    throw Error('SOURCE_COMMIT_OR_BLOB_INVALID'); return value; };
export function classifySourcePath(path: string): 'template' | 'catalog' | 'profile' | 'techniques' | 'comments' | 'index' | 'plan' | 'derived' {
    if (path === 'PGT/master_data/tecnics_base.json')
        return 'template';
    if (path === 'PGT/master_data/plans.json')
        return 'catalog';
    const match = /^PGT\/users_data\/([^/]+)\/(user_data\.json|tecnics\.json|trainer_comments\.json|plans_index\.json|training_plans\/(plan|structure)_([0-9a-f-]{36})\.json)$/.exec(path);
    if (!match || normalizedMail(match[1]) !== match[1])
        throw Error('SOURCE_PATH_NOT_CLASSIFIED');
    if (match[3])
        return match[3] === 'plan' ? 'plan' : 'derived';
    return ({ 'user_data.json': 'profile', 'tecnics.json': 'techniques', 'trainer_comments.json': 'comments', 'plans_index.json': 'index' } as const)[match[2] as 'user_data.json'];
}
function checksum(snapshot: Omit<GithubSnapshot, 'checksum'>) {
    return digest({ format: snapshot.format, repository: snapshot.repository,
        commit: snapshot.commit, tree: snapshot.tree, capturedAt: snapshot.capturedAt,
        files: snapshot.files.map(f => ({ path: f.path, blob: f.blob, bytes: f.bytes })) });
}
export function validateSnapshot(snapshot: GithubSnapshot): void {
    if (snapshot.format !== 'pgt-github-source-v1' || snapshot.repository !== SOURCE_REPOSITORY)
        throw Error('SOURCE_REPOSITORY_INVALID');
    sha(snapshot.commit);
    sha(snapshot.tree);
    if (!Number.isFinite(Date.parse(snapshot.capturedAt)))
        throw Error('SOURCE_TIMESTAMP_INVALID');
    const seen = new Set<string>();
    for (const file of snapshot.files) {
        classifySourcePath(file.path);
        sha(file.blob);
        if (seen.has(file.path))
            throw Error('SOURCE_DUPLICATE_PATH');
        seen.add(file.path);
        if (Buffer.byteLength(file.content, 'utf8') !== file.bytes || blobSha(file.content) !== file.blob)
            throw Error('SOURCE_BLOB_INTEGRITY');
        if (file.bytes > 4 * 1024 * 1024)
            throw Error('SOURCE_DOCUMENT_LIMIT');
        try {
            JSON.parse(file.content.replace(/^\uFEFF/, ''));
        }
        catch {
            throw Error('SOURCE_JSON_INVALID');
        }
    }
    if (snapshot.checksum !== checksum(snapshot))
        throw Error('SOURCE_MANIFEST_INTEGRITY');
}
/** Test/offline entrypoint: identical integrity checks, no network. */
export function snapshotFromFiles(commit: string, tree: string, files: {
    path: string;
    content: string;
}[], capturedAt = new Date().toISOString()): GithubSnapshot {
    const source: Omit<GithubSnapshot, 'checksum'> = { format: 'pgt-github-source-v1', repository: SOURCE_REPOSITORY, commit: sha(commit),
        tree: sha(tree), capturedAt, files: files.map(f => ({ ...f, blob: blobSha(f.content), bytes: Buffer.byteLength(f.content, 'utf8') })).sort((a, b) => a.path.localeCompare(b.path)) };
    const result = { ...source, checksum: checksum(source) };
    validateSnapshot(result);
    return result;
}
/** Administrative extractor only. Capability is hard-coded GET for one repository. */
export async function extractGithubSnapshot(options: {
    commit: string;
    token: string;
    transport?: SourceTransport;
    maxFiles?: number;
    maxBytes?: number;
    clock?: () => Date;
}): Promise<GithubSnapshot> {
    sha(options.commit);
    if (!options.token)
        throw Error('SOURCE_READ_CREDENTIAL_REQUIRED');
    const transport = options.transport ?? ((url, init) => fetch(url, init));
    const read = async (path: string) => {
        const response = await transport('https://api.github.com/repos/' + SOURCE_REPOSITORY + path, {
            method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(15000),
            headers: { Authorization: 'Bearer ' + options.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10', 'User-Agent': 'PGT-ReadOnly-Migration' }
        });
        if (!response.ok)
            throw Error('SOURCE_READ_HTTP_' + response.status);
        return response.json() as Promise<any>;
    };
    const commit = await read('/git/commits/' + options.commit);
    if (commit.sha !== options.commit)
        throw Error('SOURCE_COMMIT_MISMATCH');
    const tree = sha(commit.tree?.sha);
    const inventory = await read('/git/trees/' + tree + '?recursive=1');
    if (inventory.sha !== tree || inventory.truncated || !Array.isArray(inventory.tree))
        throw Error('SOURCE_TREE_INCOMPLETE');
    const entries = inventory.tree.filter((e: any) => e.type === 'blob' && typeof e.path === 'string' && e.path.startsWith('PGT/') && e.path.endsWith('.json'));
    for (const entry of entries) {
        classifySourcePath(entry.path);
        sha(entry.sha);
        if (entry.mode !== '100644' && entry.mode !== '100755')
            throw Error('SOURCE_FILE_MODE_INVALID');
    }
    if (entries.length > (options.maxFiles ?? 1000) || entries.reduce((n: number, e: any) => n + (e.size ?? 0), 0) > (options.maxBytes ?? 128 * 1024 * 1024))
        throw Error('SOURCE_EXTRACTION_BUDGET');
    const files: SourceFile[] = [];
    for (const entry of entries) {
        const blob = await read('/git/blobs/' + entry.sha);
        if (blob.sha !== entry.sha || blob.encoding !== 'base64' || typeof blob.content !== 'string')
            throw Error('SOURCE_BLOB_INVALID');
        const bytes = Buffer.from(blob.content.replace(/\s/g, ''), 'base64');
        const content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
        if (blobSha(content) !== entry.sha || bytes.length !== blob.size)
            throw Error('SOURCE_BLOB_INTEGRITY');
        files.push({ path: entry.path, blob: entry.sha, bytes: bytes.length, content });
        if (files.reduce((n, f) => n + f.bytes, 0) > (options.maxBytes ?? 128 * 1024 * 1024))
            throw Error('SOURCE_EXTRACTION_BUDGET');
    }
    return snapshotFromFiles(options.commit, tree, files, options.clock?.().toISOString());
}
