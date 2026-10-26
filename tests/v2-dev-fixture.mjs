import {structuredFixture} from './structured-firestore-fixture.ts';
import {NativeFirestore} from '../worker/structured/firestore.ts';
import {NativeAggregates} from '../worker/v2/aggregates.ts';
import {nativeWrite} from '../worker/v2/plans.ts';
import {passwordHash} from '../worker/security.ts';
import {cloneTemplate,initialVersion} from '../src/domain/models.ts';
import {template} from './template-fixture.ts';
/** Synthetic verified import. No source extraction, Google call or production account. */
export async function v2DevFixture(){
    const f=await structuredFixture(),db=new NativeFirestore(f.env,f.transport),namespace='pgt_v2/import-'+'c'.repeat(24),sourceCommit='d'.repeat(40);
    const store=new NativeAggregates(db,namespace),password='synthetic-v2-runtime-password',mail='trainer-v2@example.test';
    const profile={...initialVersion(),mail,nombre:'Trainer',apellidos:'Synthetic',perfil:'entrenador',cinturon:'Blanco',peso:null,fecha_nacimiento:null,pwd:await passwordHash(password)};
    await store.publish([
        {ref:{kind:'template',id:'official'},data:template,expected:null},
        {ref:{kind:'profile',id:mail},data:profile,expected:null},
        {ref:{kind:'repertoire',id:mail},data:cloneTemplate(template),expected:null},
        {ref:{kind:'comments',id:mail},data:{...initialVersion(),comments:[]},expected:null},
        {ref:{kind:'assignment',id:mail},data:{...initialVersion(),planIds:[]},expected:null},
        {ref:{kind:'catalog',id:'competitions'},data:{...initialVersion(),plans:[],deletedPlanIds:[]},expected:null},
        {ref:{kind:'roster',id:'users'},data:{users:[{mail,nombre:profile.nombre,apellidos:profile.apellidos,perfil:profile.perfil}]},expected:null},
        {ref:{kind:'agenda',id:'calendar'},data:{months:[]},expected:null}
    ],crypto.randomUUID());
    await db.commit([
        nativeWrite(db,namespace,{format:'pgt-import-v2',phase:'verified',sourceCommit,active:true},null),
        nativeWrite(db,'pgt_v2/control',{phase:'active',project:'pgt-bjj-dev',namespace,sourceCommit},null)
    ]);
    return {f,db,store,namespace,password,mail};
}
