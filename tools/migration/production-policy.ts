import type { MigrationBundle } from './convert.ts';
import { NativeFirestore } from '../../worker/structured/firestore.ts';

/** A recorded owner authorization, supplied privately AFTER the human gate.
 * Creating this file is not permission; no runtime endpoint accepts it. */
export function verifyProductionAuthorization(value: any, bundle: MigrationBundle, now = Date.now()) {
    if (!value || value.project !== 'pgt-bjj-pro' || value.database !== '(default)' ||
        value.sourceCommit !== bundle.source.commit || value.checksum !== bundle.checksum ||
        value.action !== 'initial-fixed-snapshot-migration' || value.acceptPostSnapshotChangesExcluded !== true ||
        typeof value.ownerAuthorizationReference !== 'string' || value.ownerAuthorizationReference.trim().length < 8 ||
        !Number.isFinite(value.authorizedAt) || value.authorizedAt > now ||
        !Number.isFinite(value.expiresAt) || value.expiresAt <= now || value.expiresAt > value.authorizedAt + 86400000)
        throw Error('MIGRATION_PRO_OWNER_AUTHORIZATION_REQUIRED');
}

/** Reject existing active datasets and unknown root collections before mutations.
 * A previous partial run may resume ONLY the exact bundle's inactive namespace.
 * Dedicated project/IAM exclusivity is still required: Firestore cannot atomically
 * lock arbitrary external writers through a root collection inventory. */
export async function assertInitialDestination(db: NativeFirestore, bundle: MigrationBundle) {
    if (db.project !== bundle.target || db.database !== '(default)' || !db.usage.budget)
        throw Error('MIGRATION_DESTINATION_TARGET_MISMATCH');
    const namespace = 'pgt_v2/import-' + bundle.checksum.slice(0, 24);
    const control = await db.get('pgt_v2/control', true);
    if (control) {
        if (control.data.namespace !== namespace || control.data.bundleChecksum !== bundle.checksum ||
            control.data.phase !== 'active' || control.data.project !== bundle.target ||
            control.data.database !== db.database || control.data.sourceCommit !== bundle.source.commit)
            throw Error('MIGRATION_EXISTING_ACTIVE_DATASET_REQUIRES_MAINTENANCE');
        // Read-only verification/retry of an already active identical dataset.
        return { status: 'same-active-dataset' as const };
    }
    db.usage.read();
    const response = await db.request('/documents:listCollectionIds', {
        method: 'POST', body: JSON.stringify({ pageSize: 1000 })
    }, true);
    await db.check(response);
    const inventory = await response.json() as { collectionIds?: string[]; nextPageToken?: string };
    // Google protobuf JSON omits repeated fields when the collection list is empty.
    // Accept omission only; null and malformed explicit values remain rejected.
    const collections = inventory.collectionIds === undefined ? [] : inventory.collectionIds;
    if (inventory.nextPageToken || !Array.isArray(collections) || collections.some(c => c !== 'pgt_v2'))
        throw Error('MIGRATION_DESTINATION_NOT_EMPTY');
    const roots = await db.list('pgt_v2');
    if (roots.some(r => r.path !== namespace || r.data.bundleChecksum !== bundle.checksum || r.data.active !== false))
        throw Error('MIGRATION_DESTINATION_NOT_EMPTY');
    return { status: roots.length ? 'resumable-identical-staging' as const : 'empty' as const };
}
