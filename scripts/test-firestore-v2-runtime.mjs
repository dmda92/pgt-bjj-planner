import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {structuredFixture} from '../tests/structured-firestore-fixture.ts';
import {generatePlan} from '../src/domain/planner.ts';
import {cloneTemplate,initialVersion} from '../src/domain/models.ts';
import {template} from '../tests/template-fixture.ts';
import {cursorSignature} from '../src/domain/plan-continuity.ts';
import {indexPlanText} from '../src/infrastructure/plan-text-projection.ts';
import {fingerprint} from '../worker/security.ts';
const f=await structuredFixture(),compiled=await build({
    stdin:{resolveDir:process.cwd(),sourcefile:'v2-isolated-runtime.ts',contents:`
        import {NativeFirestore} from './worker/structured/firestore.ts';
        import {PlanRepository} from './worker/v2/plans.ts';
        import {NativeAggregates} from './worker/v2/aggregates.ts';
        import {PlanViews} from './worker/v2/plan-views.ts';
        import {QueryCoordinator} from './worker/v2/query-coordinator.ts';
        import {V2Api} from './worker/v2/api.ts';
        import {TextCommands} from './worker/v2/text-commands.ts';
        import {fingerprint} from './worker/security.ts';
        export class V2TestCoordinator {
            constructor(state,env){
                this.state=state;this.env=env;this.db=new NativeFirestore(env);
                this.plans=new PlanRepository(this.db);this.aggregates=new NativeAggregates(this.db);
                this.queries=new QueryCoordinator(this.aggregates,new PlanViews(this.plans,this.aggregates));
                this.api=new V2Api(state.storage,this.queries,new TextCommands(this.queries,()=>new Date('2026-03-01T12:00:00Z')));
            }
            async fetch(request){
                const db=this.db,plans=this.plans,aggregates=this.aggregates,url=new URL(request.url);
                const before={...db.usage.totals};
                const cost=()=>Object.fromEntries(Object.entries(db.usage.totals).map(([key,value])=>[key,value-before[key]]));
                try{
                    if(url.pathname.startsWith('/api/v2/'))return this.api.fetch(request);
                    if(url.pathname==='/synthetic-session'){
                        const b=await request.json();await this.state.storage.put('pgt-v2-session:'+await fingerprint(b.token),b.session);
                        return Response.json({ok:true});
                    }
                    if(url.pathname==='/write'){
                        const b=await request.json(),version=await plans.write(b.plan,b.base??null,b.operationId);
                        return Response.json({version,cost:cost()});
                    }
                    if(url.pathname==='/read'){
                        const result=await plans.read(url.searchParams.get('owner'),url.searchParams.get('plan'),url.searchParams.get('date')??undefined);
                        return Response.json({result,cost:cost()});
                    }
                    if(url.pathname==='/publish'){
                        const b=await request.json(),result=await aggregates.publish(b.changes,b.operationId);
                        return Response.json({result,cost:cost()});
                    }
                    if(url.pathname==='/view'){
                        const result=await new PlanViews(plans,aggregates).read(url.searchParams.get('owner'),url.searchParams.get('plan'),url.searchParams.get('date')??undefined);
                        return Response.json({result,cost:cost()});
                    }
                    return Response.json({error:'NOT_FOUND'},{status:404});
                }catch(error){return Response.json({error:error.message},{status:error.status??500});}
            }
        }
        export default {fetch(request,env){return env.SECURITY.get(env.SECURITY.idFromName('v2-test')).fetch(request);}};
    `},
    bundle:true,write:false,format:'esm',target:'es2022',external:['cloudflare:workers']
});
const runtime=new Miniflare(convertV4MiniflareOptions({
    modules:true,script:compiled.outputFiles[0].text,compatibilityDate:'2026-10-13',
    durableObjects:{SECURITY:{className:'V2TestCoordinator',useSQLite:true}},
    bindings:f.env,outboundService:async request=>f.transport(request.url,{
        method:request.method,headers:Object.fromEntries(request.headers),
        ...(!['GET','HEAD'].includes(request.method)?{body:await request.text()}:{})
    })
}));
try{
    const c={planId:crypto.randomUUID(),alumnos:['runtime-v2@example.test'],fecha_comienzo:'2026-01-01',fecha_torneo:'2026-07-02',
        dias_de_entrenamiento:[1,2,3,4,5,6,7],ejercicios_por_sesion:5,tiempo_por_tecnica_segundos:180,
        descanso_entre_ciclos_segundos:10,descanso_entre_tecnicas_segundos:20};
    const techniques=cloneTemplate(template),plan=generatePlan(c,c.alumnos[0],techniques,{...initialVersion(),comments:[]},'2026-01-01T00:00:00Z');
    const operationId=crypto.randomUUID();
    let response=await runtime.dispatchFetch('http://isolated/write',{method:'POST',body:JSON.stringify({plan,operationId})});
    const written=await response.json();assert.equal(response.status,200,JSON.stringify(written));
    response=await runtime.dispatchFetch('http://isolated/read?owner='+encodeURIComponent(plan.mail)+'&plan='+plan.planId);
    const full=await response.json();assert.equal(response.status,200,JSON.stringify(full));assert.deepEqual(full.result.data,plan);
    for(const [i,b] of plan.continuity.boundaries.entries())
        assert.equal(cursorSignature(full.result.data.continuity.boundaries[i].cursor),cursorSignature(b.cursor));
    assert.equal(full.cost.estimatedReads,8);assert.equal(full.cost.attemptedWrites,0);
    response=await runtime.dispatchFetch('http://isolated/read?owner='+encodeURIComponent(plan.mail)+'&plan='+plan.planId+'&date=2026-03-20');
    const day=await response.json();assert.equal(response.status,200,JSON.stringify(day));
    assert.deepEqual(day.result.data.sessions,plan.sessions.filter(s=>s.date==='2026-03-20'));assert.equal(day.cost.estimatedReads,2);
    response=await runtime.dispatchFetch('http://isolated/write',{method:'POST',body:JSON.stringify({plan,operationId})});
    const retry=await response.json();assert.equal(response.status,200,JSON.stringify(retry));assert.equal(retry.version,written.version);assert.equal(retry.cost.attemptedWrites,0);
    const commandId=crypto.randomUUID(),changes=[
        {ref:{kind:'plan-text',id:plan.planId+'__'+plan.mail},data:indexPlanText(plan),expected:null},
        {ref:{kind:'comments',id:plan.mail},data:{...initialVersion(),comments:[]},expected:null}
    ];
    response=await runtime.dispatchFetch('http://isolated/publish',{method:'POST',body:JSON.stringify({changes,operationId:commandId})});
    const published=await response.json();assert.equal(response.status,200,JSON.stringify(published));
    assert.deepEqual(published.result,{versions:['1','1'],changed:[true,true]});assert.equal(published.cost.attemptedWrites,3);
    response=await runtime.dispatchFetch('http://isolated/publish',{method:'POST',body:JSON.stringify({changes,operationId:commandId})});
    const repeated=await response.json();assert.equal(response.status,200,JSON.stringify(repeated));
    assert.deepEqual(repeated.result,published.result);assert.equal(repeated.cost.attemptedWrites,0);
    response=await runtime.dispatchFetch('http://isolated/view?owner='+encodeURIComponent(plan.mail)+'&plan='+plan.planId+'&date=2026-03-20');
    const view=await response.json();assert.equal(response.status,200,JSON.stringify(view));assert.equal(view.cost.estimatedReads,3);
    assert.equal(view.cost.attemptedWrites,0);assert.deepEqual(view.result.data.sessions,day.result.data.sessions);
    const pwd='synthetic-v2-runtime-private-hash',token='v'.repeat(43),profile={...initialVersion(),mail:plan.mail,nombre:'Runtime',apellidos:'Synthetic',perfil:'alumno',
        cinturon:'Blanco',fecha_nacimiento:null,peso:null,pwd};
    const setup=[
        {ref:{kind:'profile',id:plan.mail},data:profile,expected:null},
        {ref:{kind:'repertoire',id:plan.mail},data:techniques,expected:null},
        {ref:{kind:'assignment',id:plan.mail},data:{...initialVersion(),planIds:[plan.planId],deletedPlanIds:[]},expected:null},
        {ref:{kind:'catalog',id:'competitions'},data:{...initialVersion(),plans:[c],deletedPlanIds:[]},expected:null}
    ];
    response=await runtime.dispatchFetch('http://isolated/publish',{method:'POST',body:JSON.stringify({changes:setup,operationId:crypto.randomUUID()})});
    assert.equal(response.status,200,JSON.stringify(await response.json()));
    response=await runtime.dispatchFetch('http://isolated/synthetic-session',{method:'POST',body:JSON.stringify({token,session:{mail:plan.mail,role:'alumno',pwdFingerprint:await fingerprint(pwd),sessionEpoch:'v2-initial'}})});
    assert.equal(response.status,200);await response.arrayBuffer();
    const sourcePath='http://isolated/api/v2/users/'+encodeURIComponent(plan.mail)+'/repertoire',headers={Authorization:'Bearer '+token};
    response=await runtime.dispatchFetch(sourcePath,{headers});assert.equal(response.status,200);await response.arrayBuffer();
    let before=f.metrics();
    response=await runtime.dispatchFetch(sourcePath,{headers});assert.equal(response.status,200);await response.arrayBuffer();
    assert.equal(f.metrics().estimatedReads,before.estimatedReads);
    const textCommand={kind:'description',operationId:crypto.randomUUID(),owner:plan.mail,techniqueId:techniques.positions[0].tecnicas[0].id,text:'Runtime future description',expected:'1'};
    response=await runtime.dispatchFetch('http://isolated/api/v2/commands/text',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(textCommand)});
    const textAck=await response.json();assert.equal(response.status,200,JSON.stringify(textAck));assert.deepEqual(textAck.versions,['2','2']);
    before=f.metrics();
    response=await runtime.dispatchFetch(sourcePath,{headers});const savedSource=await response.json();assert.equal(response.status,200,JSON.stringify(savedSource));
    assert.equal(f.metrics().estimatedReads,before.estimatedReads);assert.equal(savedSource.data.positions[0].tecnicas[0].descripcion_del_alumno,textCommand.text);
    response=await runtime.dispatchFetch('http://isolated/api/v2/commands/text',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(textCommand)});
    assert.equal(response.status,200);assert.deepEqual(await response.json(),textAck);assert.equal(f.metrics().attemptedWrites,before.attemptedWrites);
    response=await runtime.dispatchFetch('http://isolated/api/v2/users/other%40example.test/comments',{headers});assert.equal(response.status,403);await response.arrayBuffer();
    console.log('V2 workerd/SQLite isolated: exact cursors; 8 full, 2 base-date, 3 materialized-date reads; atomic ACK; authenticated HTTP text command; zero warm/confirmation reads; isolation PASS. Google intercepted.');
}finally{await runtime.dispose();}
