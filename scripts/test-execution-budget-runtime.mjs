import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';
import {structuredFixture} from '../tests/structured-firestore-fixture.ts';

const fixture = await structuredFixture(), buildId = 'a'.repeat(40);
// Local-only harness. No new public route is added to the DEV Worker.
const harness = `import {DomainIO} from './worker/dev.ts';export {DomainIO};
export default {async fetch(request,env){const meterId=env.DOMAIN_IO.idFromName('one-budget-for-all-test-executors'),meter=env.DOMAIN_IO.get(meterId);const path=new URL(request.url).pathname;try{
 if(path==='/open')return Response.json(await meter.budgetOpen(await request.json()));
 if(path==='/status')return Response.json(await meter.budgetStatus());
 if(path==='/close')return Response.json(await meter.budgetClose());
 const {phase,writes}=await request.json(),actor=env.DOMAIN_IO.get(env.DOMAIN_IO.newUniqueId());
 const result=await actor.request('https://firestore.googleapis.com/v1/projects/pgt-bjj-dev/databases/(default)/documents:commit',{method:'POST',headers:{Authorization:'Bearer isolated-fixture'},body:JSON.stringify({writes})},{id:meterId.toString(),phase});
 return Response.json({status:result.status});
 }catch(e){return Response.json({error:e.message},{status:429});}}};`;
const bundle = await build({
    stdin: {
        contents: harness,
        resolveDir: process.cwd(),
        sourcefile: 'local-budget-harness.mjs'
    }, bundle: true, write: false, external: ['cloudflare:workers'], format: 'esm', target: 'es2022'
});
let external = 0;
const runtime = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-10-13',
    durableObjects: {DOMAIN_IO: {className: 'DomainIO', useSQLite: true}},
    bindings: {...fixture.env, DEV_BUILD_SHA: buildId},
    outboundService: async request => {
        external++;
        return fixture.transport(request.url, {
            method: request.method,
            headers: request.headers,
            body: request.method === 'GET' ? undefined : await request.text()
        });
    }
}));
const call = async (path, body) => {
    const r = await runtime.dispatchFetch('http://local' + path, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(body || {})
    });
    return {status: r.status, value: await r.json()};
};
const root = 'projects/pgt-bjj-dev/databases/(default)/documents/usage/';
try {
    assert.equal((await call('/open', {
        project: 'pgt-bjj-dev',
        build: buildId,
        limits: {reads: 8, writes: 3, deletes: 3},
        cleanup: {reads: 2, writes: 1, deletes: 2},
        expiresAt: Date.now() + 60000
    })).status, 200);
    const results = await Promise.all(['one', 'two', 'three'].map(id => call('/send', {
        phase: 'scenario',
        writes: [{update: {name: root + id, fields: {n: {integerValue: '1'}}}}]
    })));
    assert.equal(results.filter(r => r.status === 200).length, 2);
    assert.equal(results.filter(r => r.status === 429).length, 1);
    assert.equal(external, 2, 'Rejected reservation must not reach Google transport');
    let status = (await call('/status')).value;
    assert.equal(status.spent.scenario.writes, 2);
    assert.equal(status.inFlight, 0);
    assert.equal(fixture.docs.size, 2);
    const writes = [...fixture.docs.keys()].map(name => ({delete: name}));
    assert.equal((await call('/send', {phase: 'cleanup', writes})).status, 200);
    assert.equal(fixture.docs.size, 0);
    assert.equal((await call('/send', {
        phase: 'scenario',
        writes: [{update: {name: root + 'late', fields: {}}}]
    })).status, 429);
    assert.equal(external, 3);
    status = (await call('/close')).value;
    assert.equal(status.spent.cleanup.deletes, 2);
    assert.equal(status.closed, true);
    assert.equal((await call('/open', {
        project: 'pgt-bjj-dev',
        build: buildId,
        limits: {reads: 8, writes: 3, deletes: 3},
        cleanup: {reads: 2, writes: 1, deletes: 2},
        expiresAt: Date.now() + 60000
    })).status, 429);
    console.log('GLOBAL_BUDGET_RUNTIME_PASS: three private RPC executors, one SQLite ledger, atomic shared limit, protected cleanup, no resend/restart; all Google HTTP intercepted.');
} finally {
    await runtime.dispose();
}
