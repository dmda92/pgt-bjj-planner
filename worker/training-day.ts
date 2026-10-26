import {structureIndex,trainingDay,validStructure,type StructureIndex} from '../src/domain/trainer-reports.ts';
import {validatePlan,type Catalog,type TrainingPlan,type Profile,type Competition} from '../src/domain/models.ts';
import type {CloudStorageProvider,CloudRecord} from './storage.ts';
import {ApiError,reject} from './security.ts';
/** Lazy, versioned projections in private GitHub. Never reads or writes business data in DO. */
export async function readTrainingDay(cloud:CloudStorageProvider,date:string,today:string,prepareMissing?:(mail:string,competition:Competition)=>Promise<CloudRecord<TrainingPlan>|undefined>){
 if(date&&(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T12:00:00Z'))||new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date))return reject(400,'DATE_INVALID');
 const catalog=await cloud.read<Catalog>('PGT/master_data/plans.json');
 const active=(catalog?.data.plans||[]).filter(c=>(date ? c.fecha_comienzo<=date&&c.fecha_torneo>date : c.fecha_torneo>=today)&&!catalog?.data.deletedPlanIds.includes(c.planId));
 const mails=[...new Set(active.flatMap(c=>c.alumnos))].sort();
 const values:{index:StructureIndex;name:string}[]=[];let missing=0,cursor=0;
 await Promise.all(Array.from({length:Math.min(4,mails.length)},async()=>{for(;;){const mail=mails[cursor++];if(!mail)return;
  const root=`PGT/users_data/${mail}`;const [profile,files]=await Promise.all([cloud.read<Profile>(root+'/user_data.json'),cloud.list?.(root+'/training_plans')]);
  if(!profile||profile.data.probeOnly){missing+=active.filter(c=>c.alumnos.includes(mail)).length;continue;}
  for(const c of active.filter(c=>c.alumnos.includes(mail))){
   let file=files?.find(f=>f.type==='file'&&f.name===`plan_${c.planId}.json`);
   if(!file&&prepareMissing){const created=await prepareMissing(mail,c);if(created)file={type:'file',name:`plan_${c.planId}.json`,sha:created.sha};}
   if(!file){missing++;continue;}
   const path=`${root}/training_plans/structure_${c.planId}.json`;const stored=await cloud.read<StructureIndex>(path);let index=stored?.data;
   if(!validStructure(index)||index.sourceSha!==file.sha||index.mail!==mail||index.planId!==c.planId){
    const plan=await cloud.read<TrainingPlan>(`${root}/training_plans/${file.name}`);if(!plan){missing++;continue;}
    if(plan.data.mail!==mail||plan.data.planId!==c.planId)return reject(409,'PLAN_IDENTITY_INVALID');
    try{validatePlan(plan.data);}catch{return reject(409,'PLAN_INVALID');}
    index=structureIndex(plan.data,plan.sha);
    try{await cloud.write(path,index,stored?.sha||null);}catch(e){if(!(e instanceof ApiError&&e.status===409))throw e;/* concurrent derived write: response still uses the verified source */}
   }
   values.push({index,name:[profile.data.nombre,profile.data.apellidos].filter(Boolean).join(' ')||mail});
  }
 }}));
 // Reject a catalogue changed during this read; never mix removed assignments into a report.
 const current=await cloud.read<Catalog>('PGT/master_data/plans.json');if(current?.sha!==catalog?.sha)return reject(409,'CATALOG_CHANGED_RETRY');
 return {...trainingDay(values,date,today),missing};
}
