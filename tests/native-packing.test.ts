import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storeNativeNode, readNativeNode, nativeBlockBytes, PLAN_BLOCK_BYTES, type PackedBlocks } from '../src/infrastructure/native-packing.ts';
for (const [name, value] of Object.entries({
    wideMap: Object.fromEntries(Array.from({ length: 12000 }, (_, i) => ['field' + i, 'x'.repeat(80)])),
    wideArray: Array.from({ length: 12000 }, (_, i) => ({ id: i, text: 'á'.repeat(80) })),
    nestedArrays: [[1, 2], [3, [4, 5]]],
    largeScalar: '😀'.repeat(100000),
    reservedKeys: { $mapLeft: 'literal', $mapRight: 'literal', $arrayLeft: [1], $arrayRight: [2] }
}))
    test('Native fragments preserve ' + name, () => {
        const blocks: PackedBlocks = {}, node = storeNativeNode(value, blocks);
        assert.deepEqual(readNativeNode(node, blocks), value);
        for (const block of Object.values(blocks))
            assert.ok(nativeBlockBytes(block) <= PLAN_BLOCK_BYTES);
    });

test('Deep logical metadata is fragmented before Firestore depth is exceeded',()=>{
    let value:unknown={leaf:'saved'};
    for(let i=0;i<25;i++)value={nested:value};
    const blocks:PackedBlocks={},node=storeNativeNode(value,blocks);
    assert.deepEqual(readNativeNode(node,blocks),value);
    for(const block of Object.values(blocks))assert.ok(nativeBlockBytes(block)<=PLAN_BLOCK_BYTES);
});
