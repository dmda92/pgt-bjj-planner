import assert from 'node:assert/strict';
import {build} from 'esbuild';
for(const entry of ['worker/dev.ts','worker/pro.ts','worker/validation.ts']) {
 const r=await build({entryPoints:[entry],bundle:true,write:false,format:'esm',target:'es2022',external:['cloudflare:workers'],metafile:true,outdir:'.worker-pro-check'});
 const inputs=Object.keys(r.metafile.inputs);
 for(const forbidden of ['worker/index.ts','worker/application.ts','worker/storage.ts']) assert.ok(!inputs.includes(forbidden),`${entry} imports ${forbidden}`);
 assert.ok(!inputs.some(p=>p.startsWith('tools/')||p.startsWith('tests/')),`${entry} imports migration or fixtures`);
 for(const out of r.outputFiles) assert.ok(!out.text.includes('api.github.com'),`${entry} contains GitHub capability`);
 console.log(`${entry}: isolated bundle compiled; no GitHub or migration capability.`);
}
