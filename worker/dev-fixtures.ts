import {template} from '../tests/template-fixture.ts';
import {initialVersion,cloneTemplate,type Profile} from '../src/domain/models.ts';
import {ApiError,passwordHash} from './security.ts';
import type {FirestoreStorage} from './firestore-storage.ts';
/** Explicitly synthetic bootstrap for DEV QA; cannot address existing accounts. */
export async function seedSynthetic(store:FirestoreStorage,runId:string,password:string){
 if(!/^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(runId)||password.length<24||password.length>100)throw new ApiError(400,'SYNTHETIC_FIXTURE_INVALID');
 const base=await store.read('PGT/master_data/tecnics_base.json');
 if(!base)await store.write('PGT/master_data/tecnics_base.json',template,null);
 const pwd=await passwordHash(password),users=[];
 for(const role of ['trainer','student','other'] as const){
  const mail=`pgt-dev-${runId}-${role}@example.test`;
  const path=`PGT/users_data/${mail}`;
  const p:Profile={...initialVersion(),mail,nombre:role==='trainer'?'Entrenador de prueba':role==='student'?'Alumno de prueba':'Otro alumno de prueba',apellidos:runId.slice(0,8),fecha_nacimiento:null,peso:null,cinturon:'Blanco',perfil:role==='trainer'?'entrenador':'alumno',pwd};
  const existing=await store.read<Profile>(path+'/user_data.json');
  if(existing)throw new ApiError(409,'SYNTHETIC_RUN_ALREADY_EXISTS');
  await store.write(path+'/user_data.json',p,null);
  await store.write(path+'/tecnics.json',cloneTemplate(template),null);
  await store.write(path+'/trainer_comments.json',{...initialVersion(),comments:[]},null);
  await store.write(path+'/plans_index.json',{...initialVersion(),planIds:[]},null);
  users.push({mail,role:p.perfil});
 }
 return {runId,users,template:'SYNTHETIC_TEST_ONLY',status:'SYNTHETIC_FIXTURE_CREATED'};
}
