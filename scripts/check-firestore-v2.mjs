import assert from 'node:assert/strict';
import {build} from 'esbuild';
const result=await build({
    entryPoints:['worker/dev.ts'],bundle:true,write:false,format:'esm',target:'es2022',
    external:['cloudflare:workers'],metafile:true,outdir:'.worker-v2-check'
});
const inputs=Object.keys(result.metafile.inputs);
for(const path of ['worker/index.ts','worker/application.ts','worker/storage.ts','worker/structured/reference-catalog.ts'])
    assert.ok(!inputs.includes(path),'V2 core imports legacy '+path);
assert.ok(!inputs.some(p=>p.startsWith('tools/')||p.startsWith('tests/')),'Migration/test code entered runtime core');
for(const out of result.outputFiles)assert.ok(!out.text.includes('api.github.com'),'GitHub capability entered V2 core');
const frontend=await build({entryPoints:['src/application/client.ts'],bundle:true,write:false,format:'esm',target:'es2022',platform:'browser',metafile:true});
for(const path of Object.keys(frontend.metafile.inputs))assert.ok(!/client-base|online-client/.test(path),'Legacy client entered frontend');
for(const out of frontend.outputFiles)assert.ok(!out.text.includes('api.github.com'),'GitHub capability entered frontend');
console.log('V2 persistence core compiled in memory; no GitHub provider, administrative migration or tests in its bundles.');
