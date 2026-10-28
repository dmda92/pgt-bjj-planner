import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { snapshotFromFiles } from '../tools/migration/github-source.ts';
import { convertSnapshot } from '../tools/migration/convert.ts';
import { stageMigration, verifyStagedMigration } from '../tools/migration/stage.ts';
import { activateMigration } from '../tools/migration/activate.ts';
import { assertInitialDestination, verifyProductionAuthorization } from '../tools/migration/production-policy.ts';
import { MigrationBudget, type MigrationGrant } from '../tools/migration/budget.ts';
import { budgetedFirestoreRequest, type BudgetStorage } from '../worker/structured/execution-budget.ts';
import { NativeFirestore } from '../worker/structured/firestore.ts';
import { FirestoreUsage } from '../worker/structured/usage.ts';
import { NativeAggregates } from '../worker/v2/aggregates.ts';
import { proMigrationFixture } from './pro-migration-fixture.ts';
import { structuredFixture } from './structured-firestore-fixture.ts';
import { passwordHash, passwordMatches } from '../worker/security.ts';
import { cloneTemplate, initialVersion, type TrainingPlan } from '../src/domain/models.ts';
import { template } from './template-fixture.ts';

test('Initial destination accepts omitted empty collectionIds from Google but rejects malformed inventories', async () => {
    const {bundle}=await source();
    for(const inventory of [{}, {collectionIds:null}, {collectionIds:'invalid'}, {collectionIds:['foreign']}, {nextPageToken:'more'}]) {
        const f=await proMigrationFixture();
        const transport=async(url:string,init?:RequestInit)=>url.endsWith('/documents:listCollectionIds')?Response.json(inventory):f.transport(url,init);
        const db=new NativeFirestore(f.env,transport,usage());
        if(Object.keys(inventory).length===0) assert.deepEqual(await assertInitialDestination(db,bundle),{status:'empty'});
        else await assert.rejects(assertInitialDestination(db,bundle),/DESTINATION_NOT_EMPTY/);
        assert.equal(db.usage.totals.attemptedWrites,0);
    }
});

async function source() {
    const p = JSON.parse(readFileSync(new URL('./fixtures/firestore/domain-baseline.json', import.meta.url), 'utf8')).fixtures[0].expected.generated as TrainingPlan;
    const root = 'PGT/users_data/' + p.mail + '/', hash = await passwordHash('Synthetic-password-123', 'synthetic-salt');
    const entries: [string, unknown][] = [
        ['PGT/master_data/tecnics_base.json', template], ['PGT/master_data/plans.json', { ...initialVersion(), plans: [{ ...p, alumnos: [p.mail] }], deletedPlanIds: [] }],
        [root + 'user_data.json', { ...initialVersion(), mail: p.mail, nombre: 'Synthetic', apellidos: 'PRO', perfil: 'entrenador', cinturon: 'Blanco', peso: null, fecha_nacimiento: null, pwd: hash }],
        [root + 'tecnics.json', cloneTemplate(template)], [root + 'trainer_comments.json', { ...initialVersion(), comments: [] }],
        [root + 'plans_index.json', { ...initialVersion(), planIds: [p.planId], deletedPlanIds: [] }], [root + 'training_plans/plan_' + p.planId + '.json', p]
    ];
    const snapshot = snapshotFromFiles('a'.repeat(40), 'b'.repeat(40), entries.map(([path, data]) => ({ path, content: JSON.stringify(data) })));
    return { snapshot, hash, p, bundle: convertSnapshot(snapshot, 'pgt-bjj-pro') };
}
const authorization = (bundle: Awaited<ReturnType<typeof source>>['bundle']) => ({ project: 'pgt-bjj-pro', database: '(default)', sourceCommit: bundle.source.commit, checksum: bundle.checksum,
    action: 'initial-fixed-snapshot-migration', acceptPostSnapshotChangesExcluded: true, ownerAuthorizationReference: 'synthetic-owner-approval', authorizedAt: Date.now(), expiresAt: Date.now() + 60000 });
const usage = () => new FirestoreUsage({ reads: 2000, writes: 1000, deletes: 0 });

test('PRO staging and CAS activation preserve original authentication and every source record without GitHub or deletes', async () => {
    const { bundle, hash, p } = await source(), before = structuredClone(bundle), f = await proMigrationFixture();
    const db = new NativeFirestore(f.env, f.transport, usage());
    assert.deepEqual(await assertInitialDestination(db, bundle), { status: 'empty' });
    const staged = await stageMigration(bundle, db), writes = db.usage.totals.attemptedWrites;
    const activated = await activateMigration(bundle, db, { async authorize() {} }, {}, null);
    assert.equal(activated.status, 'activated');
    const profile = await new NativeAggregates(db, staged.namespace).read<any>({ kind: 'profile', id: p.mail });
    assert.equal(profile!.data.pwd, hash);
    assert.equal(await passwordMatches('Synthetic-password-123', profile!.data.pwd), true);
    assert.equal(await passwordMatches('Wrong-password-123', profile!.data.pwd), false);
    assert.equal(db.usage.totals.attemptedWrites, writes + 2, 'Activation only publishes marker and pointer; no credential rewrite');
    const beforeVerify = db.usage.totals.attemptedWrites;
    await verifyStagedMigration(bundle, db);
    assert.equal(db.usage.totals.attemptedWrites, beforeVerify);
    assert.equal((await db.get('pgt_v2/control', true))!.data.database, '(default)');
    assert.equal((await db.get('pgt_v2/control', true))!.data.project, 'pgt-bjj-pro');
    assert.equal((await activateMigration(bundle, db, { async authorize() {} }, {}, null)).status, 'already-active');
    assert.deepEqual(bundle, before);
    assert.equal(db.usage.totals.attemptedDeletes, 0);
    assert.ok(f.calls.every(c => !c.url.includes('github')));
});

test('A PRO bundle cannot stage against DEV, and no target mismatch performs HTTP', async () => {
    const { bundle } = await source(), f = await structuredFixture();
    await assert.rejects(stageMigration(bundle, new NativeFirestore(f.env, f.transport, usage())), /DESTINATION_TARGET_MISMATCH/);
    assert.equal(f.metrics().httpRequests, 0);
});

test('PRO never repairs inconsistent assignment indexes and missing plans block readiness', async () => {
    const { snapshot, p } = await source();
    const changed = snapshot.files.map(f => f.path.endsWith('plans_index.json') ? { ...f, content: JSON.stringify({ ...initialVersion(), planIds: [], deletedPlanIds: [p.planId] }) } : f);
    const result = convertSnapshot(snapshotFromFiles(snapshot.commit, snapshot.tree, changed), 'pgt-bjj-pro');
    assert.equal(result.ready, false);
    assert.ok(result.issues.some(i => i.code === 'ASSIGNMENT_INDEX_INCONSISTENT' && i.blocking));
    assert.deepEqual(result.users[0].index!.planIds, []);
    assert.deepEqual(result.users[0].index!.deletedPlanIds, [p.planId]);
    const missing = convertSnapshot(snapshotFromFiles(snapshot.commit, snapshot.tree, snapshot.files.filter(f => !f.path.includes('/training_plans/'))), 'pgt-bjj-pro');
    assert.equal(missing.ready, false);
    assert.ok(missing.issues.some(i => i.code === 'ASSIGNED_PLAN_MISSING' && i.blocking));
    const badHash = snapshot.files.map(f => f.path.endsWith('user_data.json') ? { ...f, content: JSON.stringify({ ...JSON.parse(f.content), pwd: 'pbkdf2-sha256$600000$salt$invalid' }) } : f);
    assert.equal(convertSnapshot(snapshotFromFiles(snapshot.commit, snapshot.tree, badHash), 'pgt-bjj-pro').ready, false);
});

test('PRO owner authorization pins project, database, source SHA, checksum and finite permission window', async () => {
    const { bundle } = await source(), approval = authorization(bundle);
    verifyProductionAuthorization(approval, bundle);
    for (const changed of [{ project: 'pgt-bjj-dev' }, { database: 'other' }, { checksum: 'b'.repeat(64) }, { sourceCommit: 'c'.repeat(40) }, { expiresAt: Date.now() - 1 }, { acceptPostSnapshotChangesExcluded: false }, { ownerAuthorizationReference: '' }])
        assert.throws(() => verifyProductionAuthorization({ ...approval, ...changed }, bundle), /OWNER_AUTHORIZATION_REQUIRED/);
});

test('Initial destination guard refuses foreign collections and other staging bundles without mutating anything', async () => {
    const { bundle } = await source(), f = await proMigrationFixture(), db = new NativeFirestore(f.env, f.transport, usage());
    await db.commit([db.update('foreign/untouched', { protected: true }, null)]);
    const count = db.usage.totals.attemptedWrites;
    await assert.rejects(assertInitialDestination(db, bundle), /DESTINATION_NOT_EMPTY/);
    assert.equal(db.usage.totals.attemptedWrites, count);
    const clean = await proMigrationFixture(), otherDb = new NativeFirestore(clean.env, clean.transport, usage());
    await otherDb.commit([otherDb.update('pgt_v2/import-' + 'b'.repeat(24), { bundleChecksum: 'b'.repeat(64), active: false }, null)]);
    await assert.rejects(assertInitialDestination(otherDb, bundle), /DESTINATION_NOT_EMPTY/);
});

test('Independent re-verification detects persisted tampering and unexpected aggregate documents with zero writes', async () => {
    const { bundle } = await source(), f = await proMigrationFixture(), db = new NativeFirestore(f.env, f.transport, usage());
    const { namespace } = await stageMigration(bundle, db);
    await db.commit([db.update(namespace + '/aggregates/foreign__extra', { value: 'unexpected' }, null)]);
    const before = db.usage.totals.attemptedWrites;
    await assert.rejects(verifyStagedMigration(bundle, db), /INVENTORY_MISMATCH/);
    assert.equal(db.usage.totals.attemptedWrites, before);
});

test('Production migration ledger binds HTTP URL and embedded commit names to its single destination', async () => {
    const entries = new Map<string, any>();
    const storage: BudgetStorage = { async transaction(fn) { return fn({ async get(k) { return entries.get(k); }, async put(k, v) { entries.set(k, v); } }); } };
    const grant: MigrationGrant = { project: 'pgt-bjj-pro', runId: crypto.randomUUID(), checksum: 'a'.repeat(64), observedAt: Date.now(), expiresAt: Date.now() + 60000,
        remaining: { reads: 100, writes: 100, deletes: 0 }, reserve: { reads: 10, writes: 10, deletes: 0 }, limits: { reads: 20, writes: 20, deletes: 0 } };
    const ledger = new MigrationBudget(storage, grant); await ledger.open(); let calls = 0;
    const send = async () => { calls++; return Response.json({}); };
    await budgetedFirestoreRequest(ledger, 'scenario', 'https://firestore.googleapis.com/v1/projects/pgt-bjj-pro/databases/(default)/documents/x/y', {}, send);
    await assert.rejects(budgetedFirestoreRequest(ledger, 'scenario', 'https://firestore.googleapis.com/v1/projects/pgt-bjj-dev/databases/(default)/documents/x/y', {}, send), /TARGET_INVALID/);
    await assert.rejects(budgetedFirestoreRequest(ledger, 'scenario', 'https://firestore.googleapis.com/v1/projects/pgt-bjj-pro/databases/(default)/documents:commit', { method: 'POST', body: JSON.stringify({ writes: [{ update: { name: 'projects/pgt-bjj-dev/databases/(default)/documents/x/y', fields: {} } }] }) }, send), /TARGET_INVALID/);
    assert.equal(calls, 1);
});


test('PRO reports a missing plan even when its assignment index is also inconsistent', async () => {
 const d=await source();
 const files=d.snapshot.files.filter(f=>!f.path.includes('/training_plans/')).map(f=>({path:f.path,content:f.path.endsWith('plans_index.json')?JSON.stringify({...JSON.parse(f.content),planIds:[]}):f.content}));
 const b=convertSnapshot(snapshotFromFiles(d.snapshot.commit,d.snapshot.tree,files),'pgt-bjj-pro');
 assert.equal(b.ready,false);assert.ok(b.issues.some(i=>i.code==='ASSIGNMENT_INDEX_INCONSISTENT'));assert.ok(b.issues.some(i=>i.code==='ASSIGNED_PLAN_MISSING'));
 assert.deepEqual(b.users[0].index?.planIds,[]);assert.equal(b.plans.length,0);
});

test('offline PRO plan budgets actual no-refund reservations and never contacts a live transport', async () => {
 const {simulateMigrationPlan}=await import('../tools/migration/offline-plan.ts');
 const d=await source(),f=await proMigrationFixture();
 const result=await simulateMigrationPlan(d.bundle,f.env,f.transport,{});
 assert.ok(result.ledgerReservations.reads>result.estimates.estimatedReads);
 assert.ok(result.suggestedLimits.reads>=result.ledgerReservations.reads);
 assert.ok(result.suggestedLimits.writes>=result.ledgerReservations.writes);
 assert.equal(result.ledgerReservations.deletes,0);
});

test('read-only verification rejects a tampered migration manifest without mutation', async()=>{
 const d=await source(),f=await proMigrationFixture(),db=new NativeFirestore(f.env,f.transport,usage());
 const {namespace}=await stageMigration(d.bundle,db);const root=await db.get(namespace,true);
 await db.commit([db.update(namespace,{...root!.data,sourceCommit:'f'.repeat(40)},root)]);
 const before=db.usage.totals.attemptedWrites;await assert.rejects(verifyStagedMigration(d.bundle,db),/MANIFEST_MISMATCH/);
 assert.equal(db.usage.totals.attemptedWrites,before);
});


test('PRO operator CLI plans with fetch disabled, writes no password file and safely reports blocked input', async()=>{
 const fs=await import('node:fs'),os=await import('node:os'),path=await import('node:path'),url=await import('node:url'),cp=await import('node:child_process');
 const {encryptPackage}=await import('../tools/migration/private-package.ts');
 const d=await source(),key=crypto.getRandomValues(new Uint8Array(32));
 for(const blocked of [false,true]){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pgt-cli-plan-'));
  try{
   const snapshot=blocked?snapshotFromFiles(d.snapshot.commit,d.snapshot.tree,d.snapshot.files.filter(f=>!f.path.includes('/training_plans/')).map(f=>({path:f.path,content:f.content}))):d.snapshot;
   const b=blocked?convertSnapshot(snapshot,'pgt-bjj-pro'):d.bundle;
   fs.writeFileSync(path.join(root,'source.enc.json'),JSON.stringify(encryptPackage(snapshot,key)));
   fs.writeFileSync(path.join(root,'key.bin'),key);fs.writeFileSync(path.join(root,'bundle.enc.json'),JSON.stringify(encryptPackage(b,key)));
   const guard=path.join(root,'offline-guard.mjs');fs.writeFileSync(guard,"globalThis.fetch=()=>{throw Error('UNEXPECTED_LIVE_FETCH')};");
   const child=cp.spawnSync(process.execPath,['--experimental-strip-types','--import',url.pathToFileURL(guard).href,url.fileURLToPath(new URL('../scripts/run-dev-migration.mjs',import.meta.url)),'plan',root,'--target','pgt-bjj-pro'],{encoding:'utf8',windowsHide:true,timeout:20000});
   assert.equal(child.status,0,child.stderr);assert.ok(!child.stdout.includes(d.hash));assert.equal(fs.existsSync(path.join(root,'dev-credentials.json')),false);
   const report=JSON.parse(fs.readFileSync(path.join(root,blocked?'plan-blocked.json':'plan.json'),'utf8'));
   assert.equal(report.status,blocked?'BLOCKED_OFFLINE_NO_NETWORK':'OFFLINE_SIMULATION_ONLY');
   if(!blocked)assert.ok(report.suggestedLimits.reads>=report.ledgerReservations.reads);else assert.equal(report.estimates,null);
  }finally{for(const file of fs.readdirSync(root))fs.unlinkSync(path.join(root,file));fs.rmdirSync(root);}
 }
});


test('an idempotent activation cannot accept a matching namespace with crossed active-control metadata', async()=>{
 const d=await source(),f=await proMigrationFixture(),db=new NativeFirestore(f.env,f.transport,usage());
 await stageMigration(d.bundle,db);await activateMigration(d.bundle,db,{async authorize(){}},{},null);
 const control=await db.get('pgt_v2/control',true);
 await db.commit([db.update('pgt_v2/control',{...control!.data,project:'pgt-bjj-dev'},control)]);
 const before=db.usage.totals.attemptedWrites;
 await assert.rejects(assertInitialDestination(db,d.bundle),/EXISTING_ACTIVE/);
 await assert.rejects(activateMigration(d.bundle,db,{async authorize(){}},{},null),/ACTIVATION_CONFLICT/);
 assert.equal(db.usage.totals.attemptedWrites,before);
});


test('conversion integrity compares captured records independently including password and full historical plan',async()=>{
 const {verifyProductionConversion}=await import('../tools/migration/source-integrity.ts');
 const {createHash}=await import('node:crypto');
 const d=await source();assert.equal(verifyProductionConversion(d.snapshot,d.bundle).status,'EXACT_SOURCE_RECORDS_PRESERVED');
 const tampered=structuredClone(d.bundle);tampered.users[0].profile.nombre='Changed';
 const {checksum,...body}=tampered;tampered.checksum=createHash('sha256').update(JSON.stringify(body)).digest('hex');
 assert.throws(()=>verifyProductionConversion(d.snapshot,tampered),/SOURCE_RECORD_MISMATCH/);
});


async function correctionFixture(){
 const d=await source(),missing='missing@example.test';
 const files=d.snapshot.files.map(f=>({path:f.path,content:f.content}));
 const cat=files.find(f=>f.path==='PGT/master_data/plans.json')!;const c=JSON.parse(cat.content);c.plans[0].alumnos.push(missing);cat.content=JSON.stringify(c);
 const index=files.find(f=>f.path.endsWith('plans_index.json'))!;index.content=JSON.stringify({...JSON.parse(index.content),planIds:[]});
 const profile=JSON.parse(files.find(f=>f.path.endsWith('user_data.json'))!.content);
 for(const [name,data] of [['user_data.json',{...profile,mail:missing,nombre:'Missing',perfil:'alumno'}],['tecnics.json',cloneTemplate(template)],['trainer_comments.json',{...initialVersion(),comments:[]}],['plans_index.json',{...initialVersion(),planIds:[]}]])files.push({path:'PGT/users_data/'+missing+'/'+name,content:JSON.stringify(data)});
 const snapshot=snapshotFromFiles(d.snapshot.commit,d.snapshot.tree,files);
 const rule={format:'pgt-approved-assignment-corrections-v1' as const,sourceCommit:snapshot.commit,sourceChecksum:snapshot.checksum,competitionId:d.p.planId,unassignOwner:missing,repairIndexOwner:d.p.mail,ownerAuthorizationReference:'synthetic-explicit-owner-message'};
 return {...d,snapshot,rule,missing};
}

test('explicit correction resolves only the two approved assignments and preserves every saved session and password',async()=>{
 const {verifyProductionConversion}=await import('../tools/migration/source-integrity.ts');
 const d=await correctionFixture(),before=structuredClone(d.snapshot),original=convertSnapshot(d.snapshot,'pgt-bjj-pro');
 assert.equal(original.ready,false);assert.equal(original.issues.filter(i=>i.blocking).length,3);
 const b=convertSnapshot(d.snapshot,'pgt-bjj-pro',d.rule);assert.equal(b.ready,true);assert.deepEqual(b.issues,[]);
 assert.deepEqual(d.snapshot,before);assert.deepEqual(b.plans,original.plans);assert.equal(b.source.checksum,d.snapshot.checksum);
 assert.deepEqual(b.catalog!.plans[0].alumnos,[d.p.mail]);assert.deepEqual(b.users.find(u=>u.profile.mail===d.p.mail)!.index!.planIds,[d.p.planId]);
 const removed=b.users.find(u=>u.profile.mail===d.missing)!;assert.deepEqual(removed.index!.planIds,[]);assert.deepEqual(removed.index!.deletedPlanIds,[d.p.planId]);
 assert.deepEqual(b.users.map(u=>u.credential),original.users.map(u=>u.credential));
 assert.equal(verifyProductionConversion(d.snapshot,b,d.rule).status,'SOURCE_PRESERVED_WITH_APPROVED_CORRECTIONS');
 assert.throws(()=>verifyProductionConversion(d.snapshot,b),/AUTHORIZATION_REQUIRED/);
});

test('corrections reject another capture, another actor, DEV and any unapproved field without mutating source',async()=>{
 const d=await correctionFixture(),before=structuredClone(d.snapshot);
 for(const rule of [{...d.rule,sourceCommit:'f'.repeat(40)},{...d.rule,sourceChecksum:'f'.repeat(64)},{...d.rule,competitionId:crypto.randomUUID()},{...d.rule,unassignOwner:d.p.mail},{...d.rule,extra:'forbidden'}])assert.throws(()=>convertSnapshot(d.snapshot,'pgt-bjj-pro',rule));
 assert.throws(()=>convertSnapshot(d.snapshot,'pgt-bjj-dev',d.rule));assert.deepEqual(d.snapshot,before);
});

test('corrected conversion stages and verifies read-only with no generated plans or changed historical snapshots',async()=>{
 const {simulateMigrationPlan}=await import('../tools/migration/offline-plan.ts');
 const d=await correctionFixture(),b=convertSnapshot(d.snapshot,'pgt-bjj-pro',d.rule),f=await proMigrationFixture();
 const report=await simulateMigrationPlan(b,f.env,f.transport,{});assert.equal(report.estimates.attemptedDeletes,0);
 const namespace='pgt_v2/import-'+b.checksum.slice(0,24),store=new NativeAggregates(new NativeFirestore(f.env,f.transport,usage()),namespace);
 assert.deepEqual((await store.read<any>({kind:'assignment',id:d.missing}))!.data.deletedPlanIds,[d.p.planId]);
 assert.equal(b.plans.length,1);assert.deepEqual(b.plans[0].plan,d.bundle.plans[0].plan);
});
