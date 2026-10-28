import { NativeFirestore } from '../structured/firestore.ts';
import { migrationNamespace } from './aggregates.ts';

/** Called exclusively inside the academy's serialized writer boundary. Only one
 * entity's immutable blocks are listed; operation receipts and business roots survive.
 * Register the target durably BEFORE staging, so failed publications are recoverable.
 */
export async function collectUnusedBlocks(db: NativeFirestore, namespace: string, target: string, token = '') {
    migrationNamespace(namespace);
    if (!target.startsWith(namespace + '/') ||
        !/^(aggregates|plans)\/[A-Za-z0-9@._+-]{1,300}$/.test(target.slice(namespace.length + 1)) || target.includes('..'))
        throw Error('BLOCK_CLEANUP_TARGET_INVALID');
    const root = await db.get(target, true);
    if (root && !root.data.headNode && !['pgt-native-v2', 'pgt-plan-v2'].includes(root.data.format ?? root.data.head?.format))
        throw Error('BLOCK_CLEANUP_ROOT_INVALID');
    const references = root ? root.data.blocks ?? root.data.blockIds : [];
    if (!Array.isArray(references) || references.some(id => typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)))
        throw Error('BLOCK_CLEANUP_REFERENCES_INVALID');
    const keep = new Set<string>(references), page = await db.page(target + '/blocks', token);
    const obsolete = page.rows.filter(row => /^[a-f0-9]{64}$/.test(row.id) && !keep.has(row.id));
    if (obsolete.length) await db.deleteRows(obsolete);
    return { token: page.nextPageToken ?? '', removed: obsolete.length, inspected: page.rows.length };
}
