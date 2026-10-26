import { NativeFirestore, type NativeRow } from '../structured/firestore.ts';
import { ApiError } from '../security.ts';
import { nativeWrite } from './plans.ts';
import { PLAN_BLOCK_BYTES, nativeBlockBytes, nativeValueBytes, storeNativeNode, readNativeNode, blockDigest, putPackedBlock, type NativeNode, type PackedBlocks } from '../../src/infrastructure/native-packing.ts';
import { jsonBytes } from '../../src/domain/json-limits.ts';
import type { PreparedPlan } from './plans.ts';
import { packPlanText, unpackPlanText } from '../../src/infrastructure/plan-text-storage.ts';
import type { PlanTextProjection } from '../../src/infrastructure/plan-text-projection.ts';
export type AggregateKind = 'profile' | 'repertoire' | 'comments' | 'assignment' | 'catalog' | 'template' | 'plan-text' | 'agenda' | 'roster' | 'maintenance';
export type AggregateRef = {
    kind: AggregateKind;
    id: string;
};
export type AggregateChange = { ref: AggregateRef; data: unknown; expected: string | null };
export type Publication = { versions: string[]; changed: boolean[]; metadata?: Record<string, string>; plans?: { owner: string; planId: string; version: string | null; changed: boolean }[] };
export type CommandIdentity = { operationId: string; requestHash: string };
type Head = {
    format: 'pgt-native-v2';
    kind: AggregateKind;
    id: string;
    version: number;
    node: NativeNode;
    blocks: string[];
    contentHash: string;
    encoding?: 'plan-text-v2';
};
const storedData = (ref: AggregateRef, data: unknown) => ref.kind === 'plan-text' && (data as PlanTextProjection)?.format === 'pgt-plan-text-v2'
    ? { value: packPlanText(data as PlanTextProjection), encoding: 'plan-text-v2' as const } : { value: data };
export function migrationNamespace(value = 'pgt_v2/main') {
    if (!/^pgt_v2\/(main|import-[a-f0-9]{24})$/.test(value))
        throw new ApiError(400, 'V2_NAMESPACE_INVALID');
    return value;
}
/** Physical native packing, not a public generic resource API. Business validation belongs to commands. */
export class NativeAggregates {
    onBlocksStaged: (target: string) => Promise<void> = async () => {};
    readonly db: NativeFirestore;
    readonly namespace: string;
    constructor(db: NativeFirestore, namespace = 'pgt_v2/main') { this.db = db; this.namespace = migrationNamespace(namespace); }
    private path(ref: AggregateRef) {
        if (!['profile', 'repertoire', 'comments', 'assignment', 'catalog', 'template', 'plan-text', 'agenda', 'roster', 'maintenance'].includes(ref.kind) ||
            !/^[A-Za-z0-9@._+-]{1,256}$/.test(ref.id) || ref.id.includes('..'))
            throw new ApiError(400, 'AGGREGATE_REF_INVALID');
        return this.namespace + '/aggregates/' + ref.kind + '__' + ref.id;
    }
    /** Internal command boundary. A single commit publishes every changed head and the ACK.
     * Immutable chunks may be staged first, but are invisible until all heads commit.
     * Callers must serialize dependent commands through the same coordinator; this is
     * not authorization, and it is never exposed as a generic client write endpoint.
     */
    async publish(changes: readonly AggregateChange[], operationId: string): Promise<Publication> {
        return (await this.publishDetailed(changes, operationId)).publication;
    }
    async recoverCommand(identity: CommandIdentity): Promise<Publication | undefined> {
        if (!/^[0-9a-f]{64}$/.test(identity.requestHash) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identity.operationId))
            throw new ApiError(400, 'COMMAND_IDENTITY_INVALID');
        const row = await this.db.get(this.namespace + '/operations/c_' + identity.operationId.toLowerCase(), true);
        if (!row) return;
        if (row.data.requestHash !== identity.requestHash) throw new ApiError(409, 'OPERATION_PAYLOAD_MISMATCH');
        return row.data.result as Publication;
    }
    async publicationEvent(operationId: string): Promise<{ refs: AggregateRef[]; plans: { owner: string; planId: string }[] } | null> {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(operationId)) throw new ApiError(400, 'OPERATION_ID_INVALID');
        const row = await this.db.get(this.namespace + '/operations/c_' + operationId.toLowerCase(), true);
        return row ? { refs: row.data.refs ?? [], plans: row.data.planRefs ?? [] } : null;
    }
    async publishDetailed(changes: readonly AggregateChange[], operationId: string, command?: {
        requestHash: string; metadata?: Record<string, string>;
    }, plans: readonly PreparedPlan[] = []): Promise<{ publication: Publication; replayed: boolean }> {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(operationId))
            throw new ApiError(400, 'OPERATION_ID_INVALID');
        if (!changes.length && !plans.length || changes.length + plans.length > 400)
            throw new ApiError(400, 'PUBLICATION_SIZE_INVALID');
        const paths = changes.map(c => this.path(c.ref));
        if (command && (!/^[0-9a-f]{64}$/.test(command.requestHash) ||
            command.metadata && (Object.values(command.metadata).some(v => typeof v !== 'string') || jsonBytes(command.metadata) > 16384)))
            throw new ApiError(400, 'COMMAND_METADATA_INVALID');
        if (new Set(paths).size !== paths.length)
            throw new ApiError(400, 'PUBLICATION_DUPLICATE_ENTITY');
        const payloadHash = blockDigest(plans.length ? { changes, plans: plans.map(p => [p.owner, p.planId, p.version, p.contentHash]) } : changes), receiptPath = this.namespace + '/operations/c_' + operationId.toLowerCase();
        const recovered = (row: NativeRow | null): Publication | undefined => {
            if (!row) return;
            if (command ? row.data.requestHash !== command.requestHash : row.data.payloadHash !== payloadHash)
                throw new ApiError(409, 'OPERATION_PAYLOAD_MISMATCH');
            return row.data.result as Publication;
        };
        const receipt = recovered(await this.db.get(receiptPath, true));
        if (receipt) return { publication: receipt, replayed: true };
        // Validate every CAS before staging even one immutable chunk.
        const roots = await Promise.all(paths.map(path => this.db.get(path, true)));
        for (const [i, row] of roots.entries()) {
            if (row && (row.data.format !== 'pgt-native-v2' || row.data.kind !== changes[i].ref.kind || row.data.id !== changes[i].ref.id))
                throw new ApiError(409, 'AGGREGATE_IDENTITY_INVALID');
            if ((row ? String(row.data.version) : null) !== changes[i].expected)
                throw new ApiError(409, 'VERSION_CONFLICT');
        }
        const heads: ReturnType<typeof nativeWrite>[] = [], staged: ReturnType<typeof nativeWrite>[] = [];
        const result: Publication = { versions: [], changed: [], ...(command?.metadata ? { metadata: command.metadata } : {}) };
        if (plans.length) result.plans = plans.map(({ owner, planId, version, changed }) => ({ owner, planId, version, changed }));
        for (const [i, change] of changes.entries()) {
            const prior = roots[i]?.data as Head | undefined, contentHash = blockDigest(change.data);
            if (prior?.contentHash === contentHash) {
                result.versions.push(String(prior.version));
                result.changed.push(false);
                continue;
            }
            const blocks: PackedBlocks = {}, stored = storedData(change.ref, change.data);
            let inline = false;
            try { inline = 1024 + nativeValueBytes(stored.value, 8) < PLAN_BLOCK_BYTES - 16384; }
            catch (error) {
                if (!(error instanceof Error) || !['PLAN_NATIVE_DEPTH_LIMIT', 'PLAN_NATIVE_NESTED_ARRAY'].includes(error.message)) throw error;
            }
            let node: NativeNode = inline ? { type: 'value', value: stored.value } : storeNativeNode(stored.value, blocks);
            // Large fan-out commands publish compact pointers, never hundreds of
            // embedded projections in the same 10 MiB Firestore commit.
            if (changes.length + plans.length > 20 && node.type === 'value' && jsonBytes(node) > 8192)
                node = { type: 'ref', id: putPackedBlock(blocks, { kind: 'literal', value: node.value }) };
            const known = new Set(prior?.blocks ?? []);
            for (const [id, block] of Object.entries(blocks))
                if (!known.has(id)) staged.push(nativeWrite(this.db, paths[i] + '/blocks/' + id, block, null));
            const version = (prior?.version ?? 0) + 1;
            const head: Head = { format: 'pgt-native-v2', kind: change.ref.kind, id: change.ref.id,
                version, node, blocks: Object.keys(blocks), contentHash, ...(stored.encoding ? { encoding: stored.encoding } : {}) };
            if (Object.keys(blocks).some(id => !known.has(id)) || [...known].some(id => !blocks[id])) await this.onBlocksStaged(paths[i]);
            heads.push(nativeWrite(this.db, paths[i], head, roots[i]));
            result.versions.push(String(version));
            result.changed.push(true);
        }
        // Reject an oversized atomic publication before spending staging writes.
        for (const plan of plans) heads.push(...plan.writes);
        heads.push(nativeWrite(this.db, receiptPath, { payloadHash, result,
            refs: changes.filter((_, i) => result.changed[i]).map(c => c.ref),
            planRefs: plans.filter(p => p.changed).map(p => ({ owner: p.owner, planId: p.planId })),
            ...(command ? { requestHash: command.requestHash } : {}) }, null));
        if (jsonBytes({ writes: heads }) > 8 * 1024 * 1024)
            throw new ApiError(413, 'PUBLICATION_TOO_LARGE');
        let batch: ReturnType<typeof nativeWrite>[] = [], bytes = 0;
        const flush = async () => {
            if (!batch.length) return;
            try { await this.db.commit(batch); }
            catch (error) {
                const matches = await Promise.all(batch.map(async w => {
                    const path = w.update.name.split('/documents/')[1], saved = await this.db.get(path, true);
                    return !!saved && blockDigest(saved.data) === path.split('/').at(-1);
                }));
                if (!matches.every(Boolean)) throw error;
            }
            batch = []; bytes = 0;
        };
        for (const write of staged) {
            const size = jsonBytes(write);
            if (batch.length && (batch.length >= 400 || bytes + size > 8 * 1024 * 1024)) await flush();
            batch.push(write); bytes += size;
        }
        await flush();
        try { await this.db.commit(heads); }
        catch (error) {
            const ack = recovered(await this.db.get(receiptPath, true));
            if (ack) return { publication: ack, replayed: false };
            throw error;
        }
        return { publication: result, replayed: false };
    }
    async read<T>(ref: AggregateRef): Promise<{
        data: T;
        version: string;
    } | null> {
        const path = this.path(ref), root = await this.db.get(path);
        if (!root)
            return null;
        const h = root.data as Head;
        if (h.format !== 'pgt-native-v2' || h.kind !== ref.kind || h.id !== ref.id)
            throw new ApiError(409, 'AGGREGATE_IDENTITY_INVALID');
        const blocks: PackedBlocks = {};
        await Promise.all(h.blocks.map(async (id) => {
            if (!/^[0-9a-f]{64}$/.test(id))
                throw new ApiError(409, 'AGGREGATE_BLOCK_INVALID');
            const row = await this.db.get(path + '/blocks/' + id);
            if (!row)
                throw new ApiError(503, 'AGGREGATE_BLOCK_UNAVAILABLE');
            blocks[id] = row.data;
        }));
        try {
            const raw = readNativeNode(h.node, blocks);
            const data = (h.encoding === 'plan-text-v2' ? unpackPlanText(raw as Parameters<typeof unpackPlanText>[0]) : raw) as T;
            if (blockDigest(data) !== h.contentHash)
                throw Error();
            return { data, version: String(h.version) };
        }
        catch {
            throw new ApiError(409, 'AGGREGATE_BLOCK_INTEGRITY');
        }
    }
    async write(ref: AggregateRef, data: unknown, expected: string | null, operationId: string): Promise<string> {
        const path = this.path(ref);
        if (!/^[0-9a-f-]{36}$/i.test(operationId))
            throw new ApiError(400, 'OPERATION_ID_INVALID');
        const receiptPath = this.namespace + '/operations/a_' + blockDigest([ref, operationId]), contentHash = blockDigest(data);
        const receipt = await this.db.get(receiptPath, true);
        if (receipt) {
            if (receipt.data.contentHash !== contentHash || receipt.data.base !== expected)
                throw new ApiError(409, 'OPERATION_PAYLOAD_MISMATCH');
            return String(receipt.data.version);
        }
        const root = await this.db.get(path, true), prior = root?.data as Head | undefined;
        if ((prior ? String(prior.version) : null) !== expected)
            throw new ApiError(409, 'VERSION_CONFLICT');
        if (prior?.contentHash === contentHash)
            return String(prior.version);
        const blocks: PackedBlocks = {}, stored = storedData(ref, data);
        let inline = false;
        try {
            inline = 1024 + nativeValueBytes(stored.value, 8) < PLAN_BLOCK_BYTES - 16384;
        }
        catch (error) {
            if (!(error instanceof Error) || !['PLAN_NATIVE_DEPTH_LIMIT', 'PLAN_NATIVE_NESTED_ARRAY'].includes(error.message))
                throw error;
        }
        const node: NativeNode = inline ? { type: 'value', value: stored.value } : storeNativeNode(stored.value, blocks);
        const known = new Set(prior?.blocks ?? []);
        let batch: ReturnType<typeof nativeWrite>[] = [], bytes = 0;
        const flush = async () => {
            if (!batch.length)
                return;
            try {
                await this.db.commit(batch);
            }
            catch (error) {
                const exists = await Promise.all(batch.map(async (w) => {
                    const p = w.update.name.split('/documents/')[1], row = await this.db.get(p, true);
                    return !!row && blockDigest(row.data) === p.split('/').at(-1);
                }));
                if (!exists.every(Boolean))
                    throw error;
            }
            batch = [];
            bytes = 0;
        };
        for (const [id, b] of Object.entries(blocks)) {
            if (known.has(id))
                continue;
            const w = nativeWrite(this.db, path + '/blocks/' + id, b, null), size = jsonBytes(w);
            if (batch.length && (batch.length >= 400 || bytes + size > 8 * 1024 * 1024))
                await flush();
            batch.push(w);
            bytes += size;
        }
        await flush();
        const version = (prior?.version ?? 0) + 1, h: Head = { format: 'pgt-native-v2', kind: ref.kind, id: ref.id, version, node, blocks: Object.keys(blocks), contentHash, ...(stored.encoding ? { encoding: stored.encoding } : {}) };
        try {
            await this.db.commit([nativeWrite(this.db, path, h, root), nativeWrite(this.db, receiptPath, { contentHash, base: expected, version }, null)]);
        }
        catch (error) {
            const saved = await this.db.get(receiptPath, true);
            if (!saved || saved.data.contentHash !== contentHash || saved.data.base !== expected)
                throw error;
            return String(saved.data.version);
        }
        return String(version);
    }
}
