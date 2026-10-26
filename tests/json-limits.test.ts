import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MAX_JSON_BYTES, MAX_APP_BODY_BYTES, jsonBytes, sizeMessage} from '../src/domain/json-limits.ts';
import {jsonBody, ApiError} from '../worker/security.ts';
import {GithubContentsStorage} from '../worker/storage.ts';

test('Size limits count UTF-8 JSON bytes and allow the exact file boundary', async () => {
    const value = {text: 'a'.repeat(MAX_JSON_BYTES - 11)};
    assert.equal(jsonBytes(value), MAX_JSON_BYTES);
    assert.equal(jsonBytes({text: 'á🙂'}), 17);
    let writes = 0;
    const cloud = new GithubContentsStorage('synthetic', 'main', async () => {
        writes++;
        return Response.json({content: {sha: '1'.repeat(40)}});
    });
    await cloud.write('PGT/tecnics.json', value, null);
    await assert.rejects(cloud.write('PGT/tecnics.json', {text: value.text + 'a'}, null), (e: unknown) => e instanceof ApiError && e.size?.bytes === MAX_JSON_BYTES + 1);
    assert.equal(writes, 1);
});
test('Request security limit retains bounded stream cancellation and file-specific details', async () => {
    const request = new Request('https://pgt.example/api/app/users/qa@example.com/techniques', {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({data: {text: 'a'.repeat(MAX_APP_BODY_BYTES)}, sha: null})
    });
    await assert.rejects(jsonBody(request, MAX_APP_BODY_BYTES), (e: unknown) => e instanceof ApiError && e.status === 413 && e.size?.file === 'tecnics.json' && e.size.scope === 'request' && e.size.limitBytes === MAX_APP_BODY_BYTES);
    const message = sizeMessage({file: 'plan_example.json', bytes: MAX_JSON_BYTES + 1, limitBytes: MAX_JSON_BYTES});
    assert.match(message, /plan_example.json/);
    assert.match(message, /cambios locales se conservan/);
});
