import { ApiError } from '../security.ts';
import { DEV_PROJECT } from '../firestore-auth.ts';
import { revisionOf, NativeFirestore, type NativeRow } from './firestore.ts';
const legacy = new Set(['pgt_resources', 'pgt_qa_runs', 'pgt_changes', '_pgt_dev_diagnostics']);
const native = new Set(['users', 'technique_catalog', 'user_techniques', 'trainer_comments', 'competitions', 'competition_tombstones', 'training_plans', 'training_day_indexes', 'user_plan_assignments', 'settings', 'realtime_events', 'qa_runs', 'revision_cleanup']);
type Frame = {
    type: 'collection' | 'document' | 'delete';
    path: string;
    token?: string;
    updateTime?: string;
    exists?: boolean;
};
type Cursor = {
    mode: 'inventory' | 'delete';
    queue: Frame[];
    counts: Record<string, number>;
    deleted: Record<string, number>;
    hash: string;
    manualDEVUsers: number;
    syntheticUsers: number;
    jobId: string;
    scope: 'legacy' | 'all';
    orphans: Record<string, number>;
    qaOwnedDocuments: number;
};
/** Administrative bounded traversal. Only legacy collections can be deleted. */
export class DevMaintenance {
    constructor(db: NativeFirestore, store: DurableObjectStorage) { this.db = db; this.store = store; }
    private db: NativeFirestore;
    private store: DurableObjectStorage;
    async step(body: any) {
        if (body.project !== DEV_PROJECT || !['inventory', 'delete'].includes(body.mode))
            throw new ApiError(400, 'DEV_MAINTENANCE_TARGET_REQUIRED');
        let cursor = body.cursor as Cursor | undefined;
        if (!cursor) {
            const collections = (await this.db.collectionIds()).sort();
            const unknown = collections.filter(c => !legacy.has(c) && !native.has(c));
            if (unknown.length)
                throw new ApiError(409, 'UNKNOWN_DEV_COLLECTION_REQUIRES_REVIEW');
            if (body.mode === 'delete') {
                const approved = await this.store.get<{
                    hash: string;
                }>('structured-cleanup-approved');
                if (!approved || body.inventoryHash !== approved.hash)
                    throw new ApiError(409, 'DEV_INVENTORY_REQUIRED');
                await this.store.put('structured-maintenance-active', true);
            }
            const roots = collections.filter(c => body.scope === 'all' && body.mode === 'inventory' || legacy.has(c));
            cursor = { mode: body.mode, queue: roots.reverse().map(path => ({ type: 'collection', path })), counts: {}, deleted: {}, hash: '', manualDEVUsers: 0, syntheticUsers: 0, jobId: crypto.randomUUID(), scope: body.scope === 'all' ? 'all' : 'legacy', orphans: {}, qaOwnedDocuments: 0 };
        }
        if (cursor.mode !== body.mode || !Array.isArray(cursor.queue) || cursor.queue.length > 10000)
            throw new ApiError(400, 'DEV_CURSOR_INVALID');
        for (let n = 0; n < 12 && cursor.queue.length; n++) {
            const f = cursor.queue.pop()!, root = f.path.split('/')[0];
            if ((!legacy.has(root) && !(cursor.mode === 'inventory' && cursor.scope === 'all' && native.has(root))) || f.path.split('/').some(s => !s || s === '.' || s === '..'))
                throw new ApiError(403, 'DEV_CLEANUP_SCOPE_FORBIDDEN');
            if (f.type === 'collection') {
                const page = await this.db.page(f.path, f.token, true);
                if (page.nextPageToken)
                    cursor.queue.push({ ...f, token: page.nextPageToken });
                for (const r of page.rows.sort((a, b) => b.path.localeCompare(a.path)))
                    cursor.queue.push({ type: 'document', path: r.path, updateTime: r.updateTime, exists: r.exists });
            }
            else if (f.type === 'document') {
                const children = await this.db.collectionIds(f.path);
                if (root === 'pgt_resources' && children.some(c => c !== 'parts'))
                    throw new ApiError(409, 'UNKNOWN_LEGACY_SUBCOLLECTION');
                if (cursor.mode === 'inventory') {
                    cursor.counts[root] = (cursor.counts[root] || 0) + (f.exists ? 1 : 0);
                    if (cursor.scope === 'all' && native.has(root) && f.exists) {
                        const qa = /pgt-dev-[0-9a-f-]{36}-(?:trainer|student|other)@example\.test/;
                        const competition = root === 'competitions' ? await this.db.get(f.path) : null;
                        if (qa.test(f.path) || competition?.data.alumnos?.some((mail: string) => qa.test(mail)))
                            cursor.qaOwnedDocuments = (cursor.qaOwnedDocuments || 0) + 1;
                    }
                    if (!f.exists && children.length)
                        cursor.orphans[root] = (cursor.orphans[root] || 0) + 1;
                    const row = root === 'pgt_resources' ? await this.db.get(f.path) : null;
                    if (row && root === 'pgt_resources' && row.data.kind === 'user_data') {
                        const owner = row.data.owner;
                        if (typeof owner !== 'string')
                            throw new ApiError(409, 'UNCLASSIFIED_LEGACY_USER');
                        if (/^pgt-dev-.*@example\.test$/.test(owner))
                            cursor.syntheticUsers++;
                        else
                            cursor.manualDEVUsers++;
                    }
                    const key = await revisionOf(f.path);
                    if (cursor.scope === 'legacy')
                        await this.store.put('structured-cleanup-record:' + key, { path: f.path, updateTime: f.updateTime || null, exists: f.exists });
                    cursor.hash = await revisionOf(cursor.hash + '|' + f.path + '|' + (f.updateTime || ''));
                }
                else
                    cursor.queue.push({ ...f, type: 'delete' });
                for (const c of children.reverse())
                    cursor.queue.push({ type: 'collection', path: f.path + '/' + c });
            }
            else {
                const expected = await this.store.get<any>('structured-cleanup-record:' + await revisionOf(f.path));
                if (!expected || expected.path !== f.path || expected.updateTime !== (f.updateTime || null))
                    throw new ApiError(409, 'DEV_DOCUMENT_CHANGED_SINCE_INVENTORY');
                const current = await this.db.get(f.path);
                if (current) {
                    if (current.updateTime !== expected.updateTime)
                        throw new ApiError(409, 'DEV_DOCUMENT_CHANGED_SINCE_INVENTORY');
                    await this.db.deleteRows([current]);
                    cursor.deleted[root] = (cursor.deleted[root] || 0) + 1;
                }
            }
        }
        const done = !cursor.queue.length;
        if (done && cursor.mode === 'inventory' && cursor.scope === 'legacy')
            await this.store.put('structured-cleanup-approved', { hash: cursor.hash, counts: cursor.counts, manualDEVUsers: cursor.manualDEVUsers, syntheticUsers: cursor.syntheticUsers, provenance: 'DEV created empty; no real-account importer; owner authorizes DEV test registrations' });
        if (done && cursor.mode === 'delete') {
            const remaining = (await this.db.collectionIds()).filter(c => legacy.has(c));
            if (remaining.length)
                throw new ApiError(409, 'LEGACY_DOCUMENTS_REMAIN');
            for (const [key] of await this.store.list({ prefix: 'app-session:' }))
                await this.store.delete(key);
            for (const [key] of await this.store.list({ prefix: 'plan-update:' }))
                await this.store.delete(key);
            for (const [key] of await this.store.list({ prefix: 'structured-cleanup-record:' }))
                await this.store.delete(key);
            await this.store.delete('structured-cleanup-approved');
        }
        return { project: DEV_PROJECT, mode: cursor.mode, done, cursor: done ? undefined : cursor, counts: cursor.counts, deleted: cursor.deleted, inventoryHash: cursor.hash, orphans: cursor.orphans, qaOwnedDocuments: cursor.qaOwnedDocuments || 0, manualDEVTestRegistrations: cursor.manualDEVUsers, syntheticUsers: cursor.syntheticUsers, legacyCollectionsRemaining: done && cursor.mode === 'delete' ? [] : undefined };
    }
    async ready() { await this.store.delete('structured-maintenance-active'); }
}
