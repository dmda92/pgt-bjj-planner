import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFileSync} from 'node:fs';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {v2DevFixture} from '../tests/v2-dev-fixture.mjs';
import {madridDate} from '../src/domain/plan-text-updates.ts';
const {f,password,mail}=await v2DevFixture(),origin='https://synthetic.test';
const script=readFileSync('.worker-build/index.js','utf8');
const runtime=new Miniflare(convertV4MiniflareOptions({modules:true,script,compatibilityDate:'2026-10-13',
    durableObjects:{SECURITY:{className:'ProbeSecurity',useSQLite:true},DOMAIN_IO:{className:'DomainIO',useSQLite:true}},
    bindings:{...f.env,ALLOWED_ORIGINS:origin},outboundService:async request=>f.transport(request.url,{method:request.method,headers:request.headers,
        ...(!['GET','HEAD'].includes(request.method)?{body:await request.text()}:{})})}));
const sockets=[];
async function api(path,body,token='',expected=200){
    const response=await runtime.dispatchFetch('https://local/api/v2/'+path,{method:body===undefined?'GET':'POST',
        headers:{Origin:origin,'CF-Connecting-IP':crypto.randomUUID(),...(token?{Authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},
        ...(body===undefined?{}:{body:JSON.stringify(body)})});
    const value=await response.json();assert.equal(response.status,expected,JSON.stringify(value));return value;
}
try{
    const before=f.metrics(),health=await runtime.dispatchFetch('https://local/api/dev/runtime');assert.equal(health.status,200);await health.arrayBuffer();
    assert.equal(f.metrics().httpRequests,before.httpRequests);
    const hostile=await runtime.dispatchFetch('https://local/api/v2/auth/login',{method:'POST',headers:{Origin:'https://evil.test'}});assert.equal(hostile.status,403);await hostile.arrayBuffer();
    assert.equal(f.metrics().httpRequests,before.httpRequests);
    const trainer=await api('auth/login',{mail,password});assert.ok(!JSON.stringify(trainer).includes('pbkdf2'));
    const pupil=await api('auth/register',{mail:'pupil-v2@example.test',password,confirm:password,nombre:'Pupil',apellidos:'Synthetic'},'',201);
    await api('users/'+mail+'/comments',undefined,pupil.token,403);
    const ticket=await api('realtime-ticket',{},pupil.token);
    const upgraded=await runtime.dispatchFetch('https://local/api/v2/realtime?ticket='+ticket.ticket,{headers:{Origin:origin,Upgrade:'websocket'}});
    assert.equal(upgraded.status,101);const ws=upgraded.webSocket;sockets.push(ws);
    const events=[];ws.addEventListener('message',e=>events.push(JSON.parse(e.data)));ws.accept();
    const today=madridDate(),date=days=>{const d=new Date(today+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);};
    const c={fecha_comienzo:date(-5),fecha_torneo:date(20),alumnos:[mail,pupil.profile.mail],dias_de_entrenamiento:[1,2,3,4,5,6,7],
        ejercicios_por_sesion:5,tiempo_por_tecnica_segundos:180,descanso_entre_ciclos_segundos:10,descanso_entre_tecnicas_segundos:20};
    const created=await api('commands/competition',{competition:c,expected:'1',operationId:crypto.randomUUID()},trainer.token);
    const id=created.metadata.planId;
    const snapshot=await api('users/'+pupil.profile.mail+'/snapshot',undefined,pupil.token);assert.equal(snapshot.plans.length,1);
    assert.ok(events.some(e=>e.type==='changed'&&e.resources.some(r=>r.kind==='plan'&&r.owner===pupil.profile.mail)));
    const known=Object.fromEntries(['profile','techniques','comments','index'].map(k=>[k,snapshot[k].sha]));known['plan:'+id]=snapshot.plans[0].sha;
    let metric=f.metrics();
    const warm=await api('users/'+pupil.profile.mail+'/snapshot?known='+encodeURIComponent(JSON.stringify(known)),undefined,pupil.token);
    assert.ok(warm.plans[0].unchanged);assert.equal(f.metrics().estimatedReads,metric.estimatedReads);assert.equal(f.metrics().attemptedWrites,metric.attemptedWrites);
    const techniques=structuredClone(snapshot.techniques.data);techniques.positions[0].tecnicas[0].descripcion_del_alumno='Runtime text';
    await api('commands/repertoire',{data:techniques,expected:snapshot.techniques.sha,operationId:crypto.randomUUID()},pupil.token);
    metric=f.metrics();const changed=await api('users/'+pupil.profile.mail+'/snapshot?known='+encodeURIComponent(JSON.stringify(known)),undefined,pupil.token);
    assert.equal(f.metrics().estimatedReads,metric.estimatedReads);assert.equal(changed.techniques.data.positions[0].tecnicas[0].descripcion_del_alumno,'Runtime text');
    const report=await api('training-day?date='+date(1),undefined,trainer.token);assert.ok(report.groups.length);
    metric=f.metrics();await api('training-day?date='+date(1),undefined,trainer.token);assert.equal(f.metrics().estimatedReads,metric.estimatedReads);
    const count=events.length;await api('commands/role',{mail:pupil.profile.mail,perfil:'entrenador',expected:snapshot.profile.sha,operationId:crypto.randomUUID()},trainer.token);
    await api('users/'+pupil.profile.mail+'/comments',undefined,pupil.token,401);
    assert.ok(events.length>=count);
    console.log('Actual DEV V2 Worker, synthetic verified import: auth, CORS, WebSockets, atomic plans, history, selective warm snapshots, zero read-after-ACK, agenda and role revocation PASS. Google/GitHub intercepted.');
}finally{for(const ws of sockets)try{ws.close();}catch{}await runtime.dispose();}

// A pending import is a configuration gate, not permission to poll its pointer
// on every reconnect. Activation requires a restart; transient IO isn't cached.
const pendingFixture=await v2DevFixture();
for(const key of pendingFixture.f.docs.keys())if(key.endsWith('/documents/pgt_v2/control'))pendingFixture.f.docs.delete(key);
const pendingRuntime=new Miniflare(convertV4MiniflareOptions({modules:true,script,compatibilityDate:'2026-10-13',
    durableObjects:{SECURITY:{className:'ProbeSecurity',useSQLite:true},DOMAIN_IO:{className:'DomainIO',useSQLite:true}},
    bindings:{...pendingFixture.f.env,ALLOWED_ORIGINS:origin},outboundService:async request=>pendingFixture.f.transport(request.url,{method:request.method,headers:request.headers,
        ...(!['GET','HEAD'].includes(request.method)?{body:await request.text()}:{})})}));
try{
    const before=pendingFixture.f.metrics();
    for(let i=0;i<20;i++){
        const response=await pendingRuntime.dispatchFetch('https://local/api/v2/users/synthetic@example.test/snapshot',{headers:{Origin:origin,Authorization:'Bearer '+'x'.repeat(43)}});
        assert.equal(response.status,503);assert.equal((await response.json()).error,'V2_MIGRATION_NOT_ACTIVATED');
    }
    assert.equal(pendingFixture.f.metrics().estimatedReads-before.estimatedReads,1);
    assert.equal(pendingFixture.f.metrics().attemptedWrites,before.attemptedWrites);
    console.log('Unactivated V2: 20 reconnect requests cost one configuration read, zero writes; no ongoing quota polling PASS.');
}finally{await pendingRuntime.dispose();}

// Ordinary autosave can exceed ten changes; the finite abuse ceiling still
// rejects before any business database request and communicates Retry-After.
const rateFixture=await v2DevFixture();
const rateRuntime=new Miniflare(convertV4MiniflareOptions({modules:true,script,compatibilityDate:'2026-10-13',
    durableObjects:{SECURITY:{className:'ProbeSecurity',useSQLite:true},DOMAIN_IO:{className:'DomainIO',useSQLite:true}},
    bindings:{...rateFixture.f.env,ALLOWED_ORIGINS:origin},outboundService:async request=>rateFixture.f.transport(request.url,{method:request.method,headers:request.headers,
        ...(!['GET','HEAD'].includes(request.method)?{body:await request.text()}:{})})}));
try{
    const call=async(path,body,token='')=>{
        const response=await rateRuntime.dispatchFetch('https://local/api/v2/'+path,{method:body===undefined?'GET':'POST',
            headers:{Origin:origin,...(token?{Authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},
            ...(body===undefined?{}:{body:JSON.stringify(body)})});
        return {response,value:await response.json()};
    };
    const login=await call('auth/login',{mail:rateFixture.mail,password:rateFixture.password});assert.equal(login.response.status,200);
    const token=login.value.token;
    for(let i=1;i<=61;i++){
        const source=(await call('users/'+rateFixture.mail+'/repertoire',undefined,token)).value;
        const before=rateFixture.f.metrics();
        const result=await call('commands/text',{kind:'description',owner:rateFixture.mail,techniqueId:source.data.positions[0].tecnicas[0].id,
            text:'Synthetic autosave '+i,expected:source.version,operationId:crypto.randomUUID()},token);
        if(i<=60)assert.equal(result.response.status,200);
        else{
            assert.equal(result.response.status,429);assert.equal(result.value.error,'RATE_LIMIT');
            assert.ok(Number(result.response.headers.get('Retry-After'))>=1);
            assert.equal(rateFixture.f.metrics().estimatedReads,before.estimatedReads);
            assert.equal(rateFixture.f.metrics().attemptedWrites,before.attemptedWrites);
        }
    }
    console.log('Autosave runtime: 60 ordinary saves accepted, excess throttled before database IO with Retry-After PASS. Google intercepted.');
}finally{await rateRuntime.dispose();}
