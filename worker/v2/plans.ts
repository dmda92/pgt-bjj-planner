import { stageImmutableBlocks } from './immutable-blocks.ts';
import type { TrainingPlan } from '../../src/domain/models.ts';
import { validatePlan, validDate } from '../../src/domain/models.ts';
import { MAX_JSON_BYTES, jsonBytes } from '../../src/domain/json-limits.ts';
import { encodePlan, decodePlan, nativeBlockBytes, PLAN_BLOCK_BYTES, type EncodedPlan, type PlanHead, type PlanBlock } from '../../src/infrastructure/plan-codec.ts';
import { NativeFirestore, type NativeRow } from '../structured/firestore.ts';
import { ApiError, normalizedMail } from '../security.ts';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { blockDigest, storeNativeNode, putPackedBlock, readNativeNode, type NativeNode, type PackedBlocks } from '../../src/infrastructure/native-packing.ts';
export interface StoredPlan {
    owner: string;
    planId: string;
    operationId: string;
    contentHash: string;
    baseHash: string;
    version: number;
    head: PlanHead;
    headNode?: NativeNode;
    blockIds: string[];
}
export interface PlanRecord {
    data: TrainingPlan;
    version: string;
    baseHash: string;
}
export interface PreparedPlan {
    writes: any[];
    owner: string;
    planId: string;
    version: string | null;
    contentHash: string;
    changed: boolean;
    retiredBlocks: string[];
}
const canonical = (value: unknown) => JSON.stringify(value, (_k, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : v);
const hash = (value: unknown) => bytesToHex(sha256(new TextEncoder().encode(canonical(value))));
const uuid = (value: string) => { if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))
    throw new ApiError(400, 'PLAN_ID_INVALID'); return value.toLowerCase(); };
/** V2 keeps business ISO strings literal. Only Firestore envelope times are native timestamps. */
function native(value: unknown): unknown {
    if (value === null)
        return { nullValue: null };
    if (typeof value === 'string')
        return { stringValue: value };
    if (typeof value === 'boolean')
        return { booleanValue: value };
    if (typeof value === 'number' && Number.isFinite(value))
        return Number.isSafeInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
    if (Array.isArray(value)) {
        if (value.some(Array.isArray))
            throw new ApiError(500, 'NATIVE_NESTED_ARRAY');
        return { arrayValue: { values: value.map(native) } };
    }
    if (value && typeof value === 'object')
        return { mapValue: { fields: Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => [k, native(v)])) } };
    throw new ApiError(500, 'NATIVE_VALUE_INVALID');
}
export function nativeWrite(db: NativeFirestore, path: string, data: object, previous?: NativeRow | null) {
    if (nativeBlockBytes(data) > PLAN_BLOCK_BYTES)
        throw new ApiError(413, 'V2_NATIVE_DOCUMENT_TOO_LARGE');
    const write = db.update(path, data, previous);
    write.update.fields = (native(data) as {
        mapValue: {
            fields: Record<string, unknown>;
        };
    }).mapValue.fields;
    return write;
}
export class PlanRepository {
    onBlocksStaged: (target: string) => Promise<void> = async () => {};
    readonly db: NativeFirestore;
    readonly namespace: string;
    constructor(db: NativeFirestore, namespace = 'pgt_v2/main') {
        if (!/^pgt_v2\/(main|import-[a-f0-9]{24})$/.test(namespace))
            throw new ApiError(400, 'V2_NAMESPACE_INVALID');
        this.db = db;
        this.namespace = namespace;
    }
    private path(owner: string, planId: string) { return this.namespace + '/plans/' + uuid(planId) + '__' + normalizedMail(owner); }
    private blocks(owner: string, planId: string) { return this.path(owner, planId) + '/blocks/'; }
    /** Stage immutable content only. The caller publishes these heads atomically with
     * source/index/agenda changes and a command receipt, through its sole coordinator. */
    async prepare(plan: TrainingPlan, expected: string | null, operationId: string, compact = false): Promise<PreparedPlan> {
        validatePlan(plan); uuid(operationId);
        if (jsonBytes(plan) > MAX_JSON_BYTES) throw new ApiError(413, 'JSON_TOO_LARGE');
        const owner = normalizedMail(plan.mail), planId = uuid(plan.planId), path = this.path(owner, planId);
        const old = await this.db.get(path, true), prior = old?.data as StoredPlan | undefined;
        if ((prior ? String(prior.version) : null) !== expected) throw new ApiError(409, 'VERSION_CONFLICT');
        const encoded = encodePlan(plan), contentHash = hash(encoded.head), known = new Set(prior?.blockIds ?? []);
        if (prior?.contentHash === contentHash) return { writes: [], owner, planId, contentHash,
            version: String(prior.version), changed: false, retiredBlocks: [] };
        let headNode: NativeNode | undefined;
        if (compact && jsonBytes(nativeWrite(this.db, path, { head: encoded.head })) > 32768) {
            headNode = storeNativeNode(encoded.head, encoded.blocks);
            if (headNode.type === 'value') headNode = { type: 'ref', id: putPackedBlock(encoded.blocks, { kind: 'literal', value: headNode.value }) };
        }
        const staged = Object.entries(encoded.blocks).filter(([id]) => !known.has(id)).map(([id, block]) =>
            nativeWrite(this.db, this.blocks(owner, planId) + id, block, null));
        if (staged.length || [...known].some(id => !encoded.blocks[id])) await this.onBlocksStaged(path);
        let batch: typeof staged = [], bytes = 0;
        const flush = async () => {
            if (!batch.length) return;
            await stageImmutableBlocks(this.db, batch);
            batch = []; bytes = 0;
        };
        for (const write of staged) {
            const size = jsonBytes(write);
            if (batch.length && (batch.length >= 400 || bytes + size > 8 * 1024 * 1024)) await flush();
            batch.push(write); bytes += size;
        }
        await flush();
        const blockIds = Object.keys(encoded.blocks).sort(), version = (prior?.version ?? 0) + 1;
        const data = { owner, planId, operationId, contentHash, baseHash: blockDigest(plan), version, blockIds,
            ...(headNode ? { headNode } : { head: encoded.head }) };
        return { owner, planId, contentHash, version: String(version), changed: true,
            writes: [nativeWrite(this.db, path, data, old)], retiredBlocks: [...known].filter(id => !blockIds.includes(id)) };
    }
    async prepareRemoval(owner: string, planId: string, expected: string | null): Promise<PreparedPlan> {
        owner = normalizedMail(owner); planId = uuid(planId);
        const row = await this.db.get(this.path(owner, planId), true), prior = row?.data as StoredPlan | undefined;
        if ((prior ? String(prior.version) : null) !== expected) throw new ApiError(409, 'VERSION_CONFLICT');
        if (prior?.blockIds.length) await this.onBlocksStaged(this.path(owner, planId));
        return { owner, planId, version: null, contentHash: 'deleted', changed: !!row,
            writes: row ? [this.db.deletion(row)] : [], retiredBlocks: prior?.blockIds ?? [] };
    }
    async head(owner: string, planId: string, fresh = false): Promise<{
        data: StoredPlan;
        version: string;
    } | null> {
        const row = await this.db.get(this.path(owner, planId), fresh);
        if (!row)
            return null;
        const data = row.data as StoredPlan;
        if (data.headNode) {
            const blocks: PackedBlocks = {};
            const load = async (node: unknown): Promise<void> => {
                if (!node || typeof node !== 'object') return;
                const n = node as Record<string, unknown>;
                if (n.type === 'value') return;
                if (n.type === 'ref') {
                    const id = String(n.id);
                    if (!/^[a-f0-9]{64}$/.test(id) || !data.blockIds.includes(id)) throw new ApiError(409, 'PLAN_BLOCK_REFERENCE_INVALID');
                    if (blocks[id]) return;
                    const block = await this.db.get(this.blocks(owner, planId) + id);
                    if (!block) throw new ApiError(503, 'PLAN_BLOCK_UNAVAILABLE');
                    blocks[id] = block.data; await load(block.data);
                } else for (const child of Object.values(n)) await load(child);
            };
            await load(data.headNode);
            try { data.head = readNativeNode(data.headNode, blocks) as PlanHead; }
            catch { throw new ApiError(409, 'PLAN_BLOCK_INTEGRITY'); }
        }
        if (data.owner !== normalizedMail(owner) || data.planId !== uuid(planId) || data.head?.format !== 'pgt-plan-v2')
            throw new ApiError(409, 'PLAN_IDENTITY_INVALID');
        if (hash(data.head) !== data.contentHash || !/^[0-9a-f]{64}$/.test(data.baseHash))
            throw new ApiError(409, 'PLAN_HEAD_INTEGRITY');
        return { data, version: String(data.version) };
    }
    async read(owner: string, planId: string, date?: string, pinned?: Awaited<ReturnType<PlanRepository['head']>>): Promise<PlanRecord | null> {
        if (date !== undefined && !validDate(date))
            throw new ApiError(400, 'DATE_INVALID');
        const root = pinned === undefined ? await this.head(owner, planId) : pinned;
        if (!root)
            return null;
        const head = root.data.head, blocks: EncodedPlan['blocks'] = {};
        const pending = new Set<string>();
        const scan = (value: unknown) => {
            if (Array.isArray(value)) {
                for (const v of value)
                    scan(v);
                return;
            }
            if (!value || typeof value !== 'object')
                return;
            const v = value as Record<string, unknown>;
            if (v.type === 'value' || v.kind === 'literal' || v.kind === 'strings' || v.kind === 'dictionary')
                return;
            if (v.type === 'ref' && typeof v.id === 'string')
                pending.add(v.id);
            if (Array.isArray(v.blocks))
                for (const id of v.blocks)
                    if (typeof id === 'string')
                        pending.add(id);
            for (const x of Object.values(v))
                scan(x);
        };
        scan(head.metadata);
        scan(head.strings);
        scan(head.dictionary);
        for (const s of head.calendar)
            if (date === undefined || s.date === date)
                pending.add(s.block);
        while (pending.size) {
            const ids = [...pending];
            pending.clear();
            await Promise.all(ids.filter(id => !blocks[id]).map(async (id) => {
                if (!/^[0-9a-f]{64}$/.test(id) || !root.data.blockIds.includes(id))
                    throw new ApiError(409, 'PLAN_BLOCK_REFERENCE_INVALID');
                const row = await this.db.get(this.blocks(owner, planId) + id);
                if (!row)
                    throw new ApiError(503, 'PLAN_BLOCK_UNAVAILABLE');
                blocks[id] = row.data as PlanBlock;
                scan(row.data);
            }));
            for (const id of Object.keys(blocks))
                pending.delete(id);
        }
        try {
            return { data: decodePlan({ head, blocks }, date), version: root.version, baseHash: root.data.baseHash };
        }
        catch {
            throw new ApiError(409, 'PLAN_BLOCK_INTEGRITY');
        }
    }
    async write(plan: TrainingPlan, expectedVersion: string | null, operationId: string): Promise<string> {
        validatePlan(plan);
        if (jsonBytes(plan) > MAX_JSON_BYTES)
            throw new ApiError(413, 'JSON_TOO_LARGE');
        uuid(operationId);
        const owner = normalizedMail(plan.mail), planId = uuid(plan.planId), encoded = encodePlan(plan);
        const path = this.path(owner, planId), blockIds = Object.keys(encoded.blocks).sort(), contentHash = hash(encoded.head);
        const operationPath = this.namespace + '/operations/' + operationId;
        const receipt = await this.db.get(operationPath, true);
        if (receipt) {
            if (receipt.data.owner !== owner || receipt.data.planId !== planId || receipt.data.contentHash !== contentHash ||
                receipt.data.baseVersion !== expectedVersion)
                throw new ApiError(409, 'OPERATION_PAYLOAD_MISMATCH');
            return String(receipt.data.savedVersion);
        }
        const old = await this.db.get(path, true), prior = old?.data as StoredPlan | undefined;
        if (prior?.operationId === operationId) {
            if (prior.contentHash !== contentHash)
                throw new ApiError(409, 'OPERATION_PAYLOAD_MISMATCH');
            return String(prior.version);
        }
        if ((prior ? String(prior.version) : null) !== expectedVersion)
            throw new ApiError(409, 'VERSION_CONFLICT');
        if (prior?.contentHash === contentHash)
            return String(prior.version);
        const known = new Set(prior?.blockIds ?? []);
        // Immutable staging is never visible until its head CAS succeeds. Orphans can be
        // retired by a later operation journal; no GET performs cleanup.
        const staged = Object.entries(encoded.blocks).filter(([id]) => !known.has(id));
        let batch: ReturnType<typeof nativeWrite>[] = [], bytes = 0;
        const flush = async () => {
            if (!batch.length)
                return;
            await stageImmutableBlocks(this.db, batch);
            batch = [];
            bytes = 0;
        };
        for (const [id, block] of staged) {
            const write = nativeWrite(this.db, this.blocks(owner, planId) + id, block, null), size = jsonBytes(write);
            if (batch.length && (batch.length >= 400 || bytes + size > 8 * 1024 * 1024))
                await flush();
            batch.push(write);
            bytes += size;
        }
        await flush();
        const version = (prior?.version ?? 0) + 1;
        const data: StoredPlan = { owner, planId, operationId, contentHash, baseHash: blockDigest(plan), version, head: encoded.head, blockIds };
        const operation = { owner, planId, contentHash, baseVersion: expectedVersion, savedVersion: version };
        try {
            await this.db.commit([nativeWrite(this.db, path, data, old), nativeWrite(this.db, operationPath, operation, null)]);
        }
        catch (error) {
            const saved = await this.db.get(operationPath, true);
            if (!saved || saved.data.owner !== owner || saved.data.planId !== planId || saved.data.contentHash !== contentHash ||
                saved.data.baseVersion !== expectedVersion)
                throw error;
            return String(saved.data.savedVersion);
        }
        return String(version);
    }
}
