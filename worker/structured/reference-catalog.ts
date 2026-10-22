import { ApiError } from '../security.ts';
import { cloneTemplate, validateTechniques, type Template } from '../../src/domain/models.ts';
import { DomainRepositories } from './repositories.ts';
import { revisionOf } from './firestore.ts';
export const referenceStructure = (positions: Template['positions']) => positions.map(p => ({ posicion: p.posicion, prioridad: p.prioridad, tecnicas: p.tecnicas.map(t => ({ tipo: t.tipo })) }));
export const CATALOG_PATH = 'PGT/master_data/tecnics_base.json';
export const CATALOG_BLOB = 'bfb542c79a086ad6f6e8a9cd5cff0efd2e46635e';
const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : v;
export async function initializeReference(repo: DomainRepositories, token: string, transport: typeof fetch = (input, init) => fetch(input, init)) {
    if (!token)
        throw new ApiError(503, 'REFERENCE_CATALOG_TOKEN_REQUIRED');
    const response = await transport('https://api.github.com/repos/dmda92/pgt-bjj-data/contents/' + CATALOG_PATH + '?ref=main', { headers: { 'User-Agent': 'PGT-BJJ-Planner-DEV-Catalog', Authorization: 'Bearer ' + token, Accept: 'application/vnd.github.object+json', 'X-GitHub-Api-Version': '2026-03-10' }, redirect: 'manual', signal: AbortSignal.timeout(15000) });
    if (!response.ok)
        throw new ApiError(503, 'REFERENCE_CATALOG_READ_HTTP_' + response.status);
    const blob = await response.json() as any;
    if (blob.sha !== CATALOG_BLOB || blob.type !== 'file' || blob.encoding !== 'base64' || !blob.content)
        throw new ApiError(409, 'REFERENCE_CATALOG_REVISION_REQUIRES_AUDIT');
    // GitHub transport encoding is decoded at this import boundary only. No
    // functional value is stored as encoded bytes/JSON strings in Firestore.
    let source: Template;
    try {
        source = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(blob.content.replace(/\s/g, '')), c => c.charCodeAt(0))));
        validateTechniques(cloneTemplate(source));
    }
    catch {
        throw new ApiError(502, 'REFERENCE_CATALOG_INVALID');
    }
    const prior = await repo.read<Template>({ kind: 'template' });
    if (prior && JSON.stringify(canonical(prior.data)) !== JSON.stringify(canonical(source)))
        throw new ApiError(409, 'REFERENCE_CATALOG_DIFFERENT');
    if (!prior)
        await repo.write({ kind: 'template' }, source, null);
    const restored = (await repo.read<Template>({ kind: 'template' }, true))?.data;
    if (JSON.stringify(canonical(restored)) !== JSON.stringify(canonical(source)))
        throw new ApiError(503, 'REFERENCE_CATALOG_INTEGRITY_FAILED');
    const report = { project: 'pgt-bjj-dev', model: 'structured-v1', sourceRepository: 'dmda92/pgt-bjj-data', sourcePath: CATALOG_PATH, sourceBlob: CATALOG_BLOB, positions: source.positions.length, techniques: source.positions.reduce((n, p) => n + p.tecnicas.length, 0), orderAndContentVerified: true, structureChecksum: await revisionOf(JSON.stringify(canonical(referenceStructure(source.positions)))), checksum: await revisionOf(JSON.stringify(canonical(source))) };
    const schema = await repo.db.get('settings/schema');
    await repo.db.commit([repo.db.update('settings/schema', { ...report, initializedAt: new Date().toISOString() }, schema)]);
    return report;
}
