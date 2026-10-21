import assert from 'node:assert/strict';
import {build} from 'esbuild';
const result=await build({entryPoints:['worker/dev.ts'],bundle:true,write:false,format:'esm',target:'es2022',metafile:true});
const inputs=Object.keys(result.metafile.inputs);
for(const name of ['worker/index.ts','worker/application.ts','worker/storage.ts','worker/firestore-storage.ts','worker/firestore-migration.ts','worker/dev-fixtures.ts'])assert.ok(!inputs.includes(name),'DEV imports legacy '+name);
assert.ok(!inputs.some(p=>p.startsWith('tests/')),'DEV imports test fixture');
console.log('DEV bundle uses native domain repositories; no GitHub file provider or synthetic reference template.');
