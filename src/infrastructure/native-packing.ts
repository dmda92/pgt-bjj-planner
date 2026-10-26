import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
export const PLAN_BLOCK_BYTES = 512 * 1024;
export type NativeNode = {
    type: 'value';
    value: unknown;
} | {
    type: 'ref';
    id: string;
};
type Tree = {
    kind: 'map';
    entries: {
        key: string;
        node: NativeNode;
    }[];
} | {
    kind: 'array';
    items: NativeNode[];
} | {
    kind: 'map-parts' | 'array-parts';
    parts: NativeNode[];
};
export type PackedBlock = {
    kind: 'sessions' | 'dictionary' | 'strings';
    rows: unknown[];
} | {
    kind: 'tree';
    tree: Tree;
} | {
    kind: 'literal';
    value: unknown;
};
export type PackedBlocks = Record<string, PackedBlock>;
const utf8 = (s: string) => new TextEncoder().encode(s).length;
export function nativeValueBytes(value: unknown, depth = 0): number {
    if (depth > 19)
        throw Error('PLAN_NATIVE_DEPTH_LIMIT');
    if (value === null || typeof value === 'boolean')
        return 1;
    if (typeof value === 'number') {
        if (!Number.isFinite(value))
            throw Error('PLAN_NATIVE_NUMBER');
        return 8;
    }
    if (typeof value === 'string')
        return utf8(value) + 1;
    if (Array.isArray(value)) {
        if (value.some(Array.isArray))
            throw Error('PLAN_NATIVE_NESTED_ARRAY');
        return value.reduce((n, v) => n + nativeValueBytes(v, depth + 1), 0);
    }
    if (value && typeof value === 'object')
        return 32 + Object.entries(value).reduce((n, [k, v]) => n + utf8(k) + 1 + nativeValueBytes(v, depth + 1), 0);
    throw Error('PLAN_NATIVE_VALUE');
}
export const nativeBlockBytes = (v: unknown) => 1024 + nativeValueBytes(v);
export const canonical = (v: unknown): string => JSON.stringify(v, (_k, x) => x && typeof x === 'object' && !Array.isArray(x) ?
    Object.fromEntries(Object.entries(x).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : x);
export const blockDigest = (v: unknown) => bytesToHex(sha256(new TextEncoder().encode(canonical(v))));
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
function fits(value: unknown, limit = PLAN_BLOCK_BYTES, reserveDepth = 0) {
    try {
        return 1024 + nativeValueBytes(value, reserveDepth) <= limit;
    }
    catch (error) {
        if (error instanceof Error && ['PLAN_NATIVE_DEPTH_LIMIT', 'PLAN_NATIVE_NESTED_ARRAY'].includes(error.message))
            return false;
        throw error;
    }
}
export function putPackedBlock(blocks: PackedBlocks, block: PackedBlock): string {
    if (!fits(block))
        throw Error('PLAN_BLOCK_TOO_LARGE');
    const id = blockDigest(block);
    blocks[id] = block;
    return id;
}
export function verifiedBlock(blocks: PackedBlocks, id: string): PackedBlock {
    const b = blocks[id];
    if (!b || blockDigest(b) !== id)
        throw Error('PLAN_BLOCK_INTEGRITY');
    return b;
}
/** Splits wide/deep native values semantically, with no JSON strings or reserved user keys. */
export function storeNativeNode(value: unknown, blocks: PackedBlocks): NativeNode {
    if (fits({ type: 'value', value }, 64 * 1024, 10))
        return { type: 'value', value };
    if (!value || typeof value !== 'object') {
        return { type: 'ref', id: putPackedBlock(blocks, { kind: 'literal', value }) };
    }
    const array = Array.isArray(value);
    const entries = array ? (value as unknown[]).map(v => storeNativeNode(v, blocks)) :
        Object.entries(value).map(([key, v]) => ({ key, node: storeNativeNode(v, blocks) }));
    const make = (rows: unknown[]): PackedBlock => array ? { kind: 'tree', tree: { kind: 'array', items: rows as NativeNode[] } } :
        { kind: 'tree', tree: { kind: 'map', entries: rows as {
                    key: string;
                    node: NativeNode;
                }[] } };
    const ids: string[] = [];
    let rows: unknown[] = [], bytes = nativeBlockBytes(make([]));
    for (const entry of entries) {
        const size = nativeValueBytes(entry);
        if (bytes + size > PLAN_BLOCK_BYTES && rows.length) {
            ids.push(putPackedBlock(blocks, make(rows)));
            rows = [];
            bytes = nativeBlockBytes(make([]));
        }
        rows.push(entry);
        bytes += size;
    }
    if (rows.length)
        ids.push(putPackedBlock(blocks, make(rows)));
    if (ids.length === 1)
        return { type: 'ref', id: ids[0] };
    return { type: 'ref', id: putPackedBlock(blocks, { kind: 'tree', tree: { kind: array ? 'array-parts' : 'map-parts',
                parts: ids.map(id => ({ type: 'ref', id })) } }) };
}
export function readNativeNode(node: NativeNode, blocks: PackedBlocks): unknown {
    if (node.type === 'value')
        return plain(node.value);
    const b = verifiedBlock(blocks, node.id);
    if (b.kind === 'literal')
        return plain(b.value);
    if (b.kind !== 'tree')
        throw Error('PLAN_BLOCK_KIND');
    const tree = b.tree;
    if (tree.kind === 'array')
        return tree.items.map(n => readNativeNode(n, blocks));
    if (tree.kind === 'map')
        return Object.fromEntries(tree.entries.map(e => [e.key, readNativeNode(e.node, blocks)]));
    if (tree.kind === 'array-parts')
        return tree.parts.flatMap(n => readNativeNode(n, blocks) as unknown[]);
    return Object.assign({}, ...tree.parts.map(n => readNativeNode(n, blocks)));
}
