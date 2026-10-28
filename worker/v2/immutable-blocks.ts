import {blockDigest} from '../../src/infrastructure/native-packing.ts';
import {NativeFirestore} from '../structured/firestore.ts';
import {ApiError} from '../security.ts';

/** Stage create-only content, without changing the CAS of any published head.
 * Normal staging adds no reads. A conflict can mix old retained chunks and new
 * chunks: an atomic failed commit saved none of the new ones. Verify old content
 * and retry only the strictly smaller missing set, with a bounded race budget.
 */
export async function stageImmutableBlocks(db: NativeFirestore, writes: ReturnType<NativeFirestore['update']>[]) {
    let pending = writes;
    for (let attempt = 0; pending.length; attempt++) {
        try { await db.commit(pending); return; }
        catch (error) {
            const conflict = error instanceof ApiError && error.status === 409 && error.message === 'VERSION_CONFLICT';
            const uncertain = error instanceof ApiError && error.message === 'FIRESTORE_NETWORK_RETRY';
            if (!conflict && !uncertain) throw error;
            const missing = (await Promise.all(pending.map(async write => {
                const path = write.update.name.split('/documents/')[1];
                const row = await db.get(path, true);
                if (!row) return write;
                if (blockDigest(row.data) !== path.split('/').at(-1))
                    throw new ApiError(409, 'IMMUTABLE_BLOCK_INTEGRITY');
                return null;
            }))).filter((write): write is typeof pending[number] => write !== null);
            if (!missing.length) return; // Includes a lost successful staging ACK.
            if (!conflict || missing.length === pending.length || attempt >= 2) throw error;
            pending = missing;
        }
    }
}
