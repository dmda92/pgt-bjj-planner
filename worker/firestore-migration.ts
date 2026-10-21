import {validateProfile,validateTechniques,validatePlan,validateCompetition,validateVersion,cloneTemplate,type Profile,type Techniques,type Comments,type Catalog,type Index,type TrainingPlan} from '../src/domain/models.ts';
import {MAX_JSON_BYTES} from '../src/domain/json-limits.ts';
import {DEV_PROJECT} from './firestore-auth.ts';
import {hex} from './firestore-storage.ts';
import type {CloudStorageProvider} from './storage.ts';
export interface MigrationRecord {path:string;data:unknown}
/** Only an explicit local synthetic export is accepted in this DEV execution.
 * No GitHub export, cloud discovery or actual user data is read by this tool. */
export async function inspectMigration(records:MigrationRecord[],project:string){
 if(project!==DEV_PROJECT||!Array.isArray(records)||records.length>25000)throw Error('DEV_SYNTHETIC_MIGRATION_REQUIRED');
 const map=new Map<string,unknown>(),owners=new Set<string>(),report=[];
 for(const r of records){
  if(!r||typeof r.path!=='string'||map.has(r.path))throw Error('MIGRATION_DUPLICATE_OR_INVALID');
  if(!/^PGT\/master_data\/(tecnics_base|plans)\.json$/.test(r.path)){
   const m=r.path.match(/^PGT\/users_data\/(pgt-dev-[a-z0-9-]+@example\.test)\/(user_data|tecnics|trainer_comments|plans_index|training_plans\/(?:plan|structure)_[0-9a-f-]{36})\.json$/);
   if(!m)throw Error('ONLY_SYNTHETIC_RECORDS_ALLOWED');owners.add(m[1]);
  }
  const json=JSON.stringify(r.data),bytes=new TextEncoder().encode(json);
  if(bytes.length>MAX_JSON_BYTES)throw Error('MIGRATION_JSON_TOO_LARGE');
  map.set(r.path,r.data);report.push({id:await hex(new TextEncoder().encode(r.path)),bytes:bytes.length,digest:await hex(bytes)});
 }
 for(const mail of owners){
  const root='PGT/users_data/'+mail+'/',p=map.get(root+'user_data.json') as Profile,t=map.get(root+'tecnics.json') as Techniques,c=map.get(root+'trainer_comments.json') as Comments,i=map.get(root+'plans_index.json') as Index;
  validateProfile(p);if(p.mail!==mail||!p.pwd?.startsWith('pbkdf2-sha256$600000$')||p.probeOnly)throw Error('MIGRATION_CREDENTIAL_OR_IDENTITY_INVALID');
  validateTechniques(t);validateVersion(c);validateVersion(i);
  if(!Array.isArray(c.comments)||!Array.isArray(i.planIds)||!Array.isArray(i.deletedPlanIds||[]))throw Error('MIGRATION_RELATIONS_INVALID');
  const ids=new Set([...t.positions.flatMap(p=>p.tecnicas.map(v=>v.id)),...t.deletedIds||[]]);
  if(c.comments.some(v=>!ids.has(v.techniqueId)||typeof v.comment!=='string'||v.comment.length>100000)||i.planIds.some(id=>i.deletedPlanIds?.includes(id)))throw Error('MIGRATION_RELATIONS_INVALID');
  for(const id of i.planIds){const plan=map.get(root+'training_plans/plan_'+id+'.json') as TrainingPlan;if(!plan||plan.mail!==mail||plan.planId!==id)throw Error('MIGRATION_PLAN_REFERENCE_INVALID');validatePlan(plan);}
 }
 const template=map.get('PGT/master_data/tecnics_base.json');if(template)validateTechniques(cloneTemplate(template as any));
 const catalog=map.get('PGT/master_data/plans.json') as Catalog|undefined;
 if(catalog){validateVersion(catalog);for(const c of catalog.plans){validateCompetition(c);if(c.alumnos.some(mail=>!owners.has(mail)))throw Error('MIGRATION_ASSIGNMENT_REFERENCE_INVALID');}}
 for(const [path,data] of map)if(/\/training_plans\/plan_/.test(path))validatePlan(data);
 return {project,records:records.length,users:owners.size,bytes:report.reduce((n,v)=>n+v.bytes,0),documents:report};
}
export async function migrateSynthetic(store:CloudStorageProvider,records:MigrationRecord[],options:{project:string;dryRun:boolean}){
 const report=await inspectMigration(records,options.project);
 if(options.dryRun)return {...report,dryRun:true,created:0,unchanged:0};
 let created=0,unchanged=0;
 for(const r of records){
  const current=await store.read(r.path);
  if(current){if(JSON.stringify(current.data)!==JSON.stringify(r.data))throw Error('MIGRATION_EXISTING_DATA_CONFLICT');unchanged++;continue;}
  await store.write(r.path,r.data,null);const roundtrip=await store.read(r.path);
  if(JSON.stringify(roundtrip?.data)!==JSON.stringify(r.data))throw Error('MIGRATION_CHECKSUM_MISMATCH');created++;
 }
 return {...report,dryRun:false,created,unchanged};
}
