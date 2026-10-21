import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';
const { config, error } = ts.parseConfigFileTextToJson('wrangler.dev.jsonc', readFileSync('wrangler.dev.jsonc', 'utf8'));
assert.equal(error, undefined);
assert.deepEqual(Object.keys(config).sort(), ['$schema','name','main','compatibility_date','workers_dev','observability','vars','assets','durable_objects','migrations'].sort());
assert.equal(config.name, 'pgt-github-probe-dev');
assert.equal(config.main, 'worker/dev.ts');
assert.deepEqual(config.assets, {directory:'./dist', binding:'ASSETS', run_worker_first:['/api/*']});
assert.deepEqual(config.durable_objects, {bindings:[{name:'SECURITY',class_name:'ProbeSecurity'}]});
// Local class binding: no script_name/environment/namespace ID referencing PRO.
assert.deepEqual(config.migrations, [{tag:'github-probe-dev-v1',new_sqlite_classes:['ProbeSecurity']}]);
assert.deepEqual(config.vars, {DATA_BRANCH:'main', FIRESTORE_PROJECT_ID:'pgt-bjj-dev', FIRESTORE_DATABASE_ID:'(default)', ALLOWED_ORIGINS:'https://pgt-github-probe-dev.david-dzm5.workers.dev'});
assert.equal(config.workers_dev, true);
assert.equal(config.routes, undefined);
assert.equal(config.route, undefined);
assert.equal(config.env, undefined);
console.log('DEV target, origin, assets and local SQLite DO binding verified. No remote operations.');

const devWorkflow=readFileSync('.github/workflows/cloudflare-dev.yml','utf8');
assert.ok(!devWorkflow.includes('feature/'),'Feature branches must never deploy directly to DEV');
assert.ok(devWorkflow.includes("github.ref == 'refs/heads/develop'"),'DEV deployment must require develop');
assert.ok(devWorkflow.includes("process.env.GITHUB_REF !== 'refs/heads/develop'"),'Runtime deployment guard must require develop');
