import {firestoreFixture} from './firestore-fixture.ts';
import {template} from './template-fixture.ts';
import {DEV_DATABASE_NAME} from '../worker/firestore-auth.ts';
const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)])):v;
export async function structuredFixture(){
 const original=await firestoreFixture(),docs=new Map<string,any>(),calls:{url:string;method:string}[]=[];let n=0,losePublication=false,failStaging=false;
 const prefix=DEV_DATABASE_NAME+'/documents/',base='https://firestore.googleapis.com/v1/'+DEV_DATABASE_NAME;
 const transport:typeof original.transport=async(url,init={})=>{
  if(url==='https://api.github.com/repos/dmda92/pgt-bjj-data/contents/PGT/master_data/tecnics_base.json?ref=main'&&!new Headers(init.headers).get('User-Agent'))return Response.json({message:'User-Agent required'},{status:403});
  if(url==='https://api.github.com/repos/dmda92/pgt-bjj-data/contents/PGT/master_data/tecnics_base.json?ref=main')return Response.json({type:'file',sha:'bfb542c79a086ad6f6e8a9cd5cff0efd2e46635e',encoding:'base64',content:Buffer.from(JSON.stringify(template)).toString('base64').match(/.{1,60}/g)!.join('\n')});
  if(!url.startsWith(base))return original.transport(url,init);
  calls.push({url,method:init.method||'GET'});
  if(!new Headers(init.headers).get('Authorization'))return Response.json({error:{status:'PERMISSION_DENIED'}},{status:403});
  const parsed=new URL(url),path=decodeURIComponent(parsed.pathname.slice(('/v1/'+DEV_DATABASE_NAME).length));
  if(!path)return Response.json({name:DEV_DATABASE_NAME,locationId:'europe-west1',databaseEdition:'STANDARD',type:'FIRESTORE_NATIVE'});
  if(path==='/documents:commit'){
   const {writes}=JSON.parse(String(init.body));
   for(const w of writes){const prior=docs.get(w.update?.name||w.delete),p=w.currentDocument;if((p?.exists===false&&prior)||(p?.updateTime&&prior?.updateTime!==p.updateTime))return Response.json({error:{code:400,status:'FAILED_PRECONDITION'}},{status:400});}
   for(const w of writes){if(w.delete)docs.delete(w.delete);else {const time='2026-10-21T10:00:'+String(Math.floor(++n/1000000)%60).padStart(2,'0')+'.'+String(n%1000000).padStart(6,'0')+'Z';docs.set(w.update.name,{...structuredClone(w.update),fields:canonical(w.update.fields),updateTime:time,createTime:docs.get(w.update.name)?.createTime||time});}}
   if(losePublication&&writes.some((w:any)=>w.update?.fields.publicationId)){losePublication=false;throw Error('lost publication ACK');}
   if(failStaging&&writes.some((w:any)=>w.update?.name.includes('/revisions/'))&&!writes.some((w:any)=>w.update?.fields.publicationId)){failStaging=false;throw Error('failed stage ACK');}
   return Response.json({writeResults:writes.map((w:any)=>w.update?{updateTime:docs.get(w.update.name).updateTime}:{}),commitTime:'fixture'});
  }
  if(path.endsWith(':listCollectionIds')){const parent=DEV_DATABASE_NAME+path.slice(0,-':listCollectionIds'.length);return Response.json({collectionIds:[...new Set([...docs.keys()].filter(k=>k.startsWith(parent+'/')).map(k=>k.slice(parent.length+1).split('/')[0]))]});}
  if(path.endsWith(':runQuery')){const parent=DEV_DATABASE_NAME+path.slice(0,-':runQuery'.length),q=JSON.parse(String(init.body)).structuredQuery,f=q.where?.fieldFilter;
   return Response.json([...docs.values()].filter(d=>d.name.startsWith(parent+'/')&&(!q.from[0].collectionId||d.name.startsWith(parent+'/'+q.from[0].collectionId+'/'))&&d.name.split('/').length===parent.split('/').length+2&&(!f||JSON.stringify(d.fields[f.field.fieldPath])===JSON.stringify(f.value))).map(document=>({document})).reverse());}
  const name=DEV_DATABASE_NAME+path;
  if((path.slice('/documents/'.length).split('/').length%2)===1){
   const direct=[...docs.values()].filter(d=>d.name.startsWith(name+'/')&&d.name.split('/').length===name.split('/').length+1);
   if(parsed.searchParams.get('showMissing')==='true'){const names=new Set([...docs.keys()].filter(k=>k.startsWith(name+'/')).map(k=>name+'/'+k.slice(name.length+1).split('/')[0]));for(const key of names)if(!docs.has(key))direct.push({name:key});}
   direct.sort((a,b)=>a.name.localeCompare(b.name));const start=Number(parsed.searchParams.get('pageToken')||0),size=Number(parsed.searchParams.get('pageSize')||200);return Response.json({documents:direct.slice(start,start+size).reverse(),...(direct.length>start+size?{nextPageToken:String(start+size)}:{})});
  }
  if(docs.has(name))return Response.json(docs.get(name));return Response.json({error:{code:404,status:'NOT_FOUND'}},{status:404});
 };
 return {env:{...original.env,GITHUB_DATA_TOKEN:'isolated-reference-fixture'},docs,calls,transport,losePublicationAck(){losePublication=true;},failStage(){failStaging=true;}};
}
