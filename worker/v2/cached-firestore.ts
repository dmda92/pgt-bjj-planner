import { VersionCache } from '../../src/application/version-cache.ts';
import { NativeFirestore, type NativeRow } from '../structured/firestore.ts';
import type { PreflightEnv } from '../firestore-preflight.ts';
import type { Transport } from '../firestore-auth.ts';
import { DEV_DATABASE_NAME } from '../firestore-auth.ts';
/** Only immutable content-addressed chunks are cached below business authorization.
 * Mutable heads/receipts always use normal reads. Migration verification deliberately
 * uses NativeFirestore instead. Fresh staging checks can never be satisfied here.
 */
export class CachedFirestore extends NativeFirestore {
    private pending: { path: string; resolve: (value: Response) => void; reject: (error: unknown) => void }[] = [];
    readonly immutable: VersionCache<NativeRow | null>;
    constructor(env: PreflightEnv, transport?: Transport, bytes = 16 * 1024 * 1024) {
        super(env, transport); this.immutable = new VersionCache(bytes);
    }
    override async commit(writes: any[]) {
        try { return await super.commit(writes); }
        finally { this.discardCommittedRows(); }
    }
    override request(path: string, init: RequestInit = {}, readOnly = false): Promise<Response> {
        if (init.method || !/^\/documents\/pgt_v2\/[A-Za-z0-9@._+/-]+$/.test(path)) return super.request(path, init, readOnly);
        return new Promise((resolve, reject) => {
            this.pending.push({ path, resolve, reject });
            if (this.pending.length === 1) queueMicrotask(() => void this.flushReads());
        });
    }
    private async flushReads() {
        const pending = this.pending; this.pending = [];
        for (let offset = 0; offset < pending.length; offset += 100) {
            const batch = pending.slice(offset, offset + 100);
            try {
                if (batch.length === 1) { batch[0].resolve(await super.request(batch[0].path, {}, true)); continue; }
                const documents = [...new Set(batch.map(p => DEV_DATABASE_NAME + p.path))];
                const response = await super.request('/documents:batchGet', { method: 'POST', body: JSON.stringify({ documents }) }, true);
                if (!response.ok) { for (const p of batch) p.resolve(response.clone()); continue; }
                const rows = await response.json() as { found?: { name: string }; missing?: string }[];
                const byName = new Map(rows.map(row => [row.found?.name ?? row.missing, row]));
                for (const p of batch) {
                    const row = byName.get(DEV_DATABASE_NAME + p.path);
                    if (!row) throw Error('FIRESTORE_BATCH_INCOMPLETE');
                }
                for (const p of batch) {
                    const row = byName.get(DEV_DATABASE_NAME + p.path)!;
                    p.resolve(row.found ? Response.json(row.found) : Response.json({ error: { code: 404 } }, { status: 404 }));
                }
            } catch (error) { for (const p of batch) p.reject(error); }
        }
    }
    override async get(path: string, fresh = false): Promise<NativeRow | null> {
        const hash = path.match(/^pgt_v2\/(?:main|import-[a-f0-9]{24})\/(?:aggregates|plans)\/[A-Za-z0-9@._+-]+\/blocks\/([a-f0-9]{64})$/)?.[1];
        if (fresh || !hash) return super.get(path, fresh);
        const value = await this.immutable.load(path, hash, () => super.get(path));
        // A missing block is not an immutable value: later create-only staging can add it.
        if (!value) this.immutable.invalidate(path);
        return value;
    }
}
