import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const read = file => { const {config,error}=ts.parseConfigFileTextToJson(file,readFileSync(file,'utf8')); assert.equal(error,undefined); return config; };
const pro=read('wrangler.jsonc'), dev=read('wrangler.dev.jsonc');
assert.equal(pro.name,'pgt-github-probe'); assert.equal(pro.main,'worker/pro.ts');
assert.deepEqual(pro.vars,{FIRESTORE_ENVIRONMENT:'pro',FIRESTORE_PROJECT_ID:'pgt-bjj-pro',FIRESTORE_DATABASE_ID:'(default)',FIRESTORE_SERVICE_ACCOUNT_EMAIL:'pgt-worker-pro@pgt-bjj-pro.iam.gserviceaccount.com',ALLOWED_ORIGINS:'https://pgt-github-probe.david-dzm5.workers.dev'});
assert.deepEqual(pro.migrations,[{tag:'github-probe-v1',new_sqlite_classes:['ProbeSecurity']},{tag:'firestore-pro-v2',new_sqlite_classes:['FirestoreSecurity','DomainIO']}]);
assert.deepEqual(pro.durable_objects.bindings,[{name:'LEGACY_SECURITY',class_name:'ProbeSecurity'},{name:'SECURITY',class_name:'FirestoreSecurity'},{name:'DOMAIN_IO',class_name:'DomainIO'}]);
for(const binding of pro.durable_objects.bindings) assert.deepEqual(Object.keys(binding).sort(),['class_name','name']);
assert.equal(pro.assets.binding,'ASSETS'); assert.deepEqual(pro.assets.run_worker_first,['/api/*']);
assert.equal(dev.vars.FIRESTORE_ENVIRONMENT,'dev'); assert.equal(dev.vars.FIRESTORE_PROJECT_ID,'pgt-bjj-dev');
for(const config of [pro,dev]) { assert.equal(config.services,undefined); assert.equal(config.env,undefined); assert.equal(config.route,undefined); assert.equal(config.routes,undefined); assert.equal(config.observability.enabled,false); }
const workflow=readFileSync('.github/workflows/cloudflare.yml','utf8');
assert.ok(workflow.includes("github.ref == 'refs/heads/main'")); assert.ok(workflow.includes("vars.FIRESTORE_PRO_READY == 'true'"));
assert.ok(workflow.includes('wrangler deploy --config wrangler.jsonc --keep-vars'));
assert.ok(!workflow.includes('run-dev-migration')); assert.ok(!workflow.includes('secret put'));
console.log('PRO configuration, retained legacy SQLite namespace, isolated V2 classes and release switch checked offline.');
