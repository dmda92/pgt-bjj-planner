import type {Transport} from '../worker/firestore-auth.ts';
import {DEV_DATABASE_NAME} from '../worker/firestore-auth.ts';
export async function firestoreFixture(){
  const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  const pk=Buffer.from(await crypto.subtle.exportKey('pkcs8',keys.privateKey)).toString('base64');
  const env={FIRESTORE_PROJECT_ID:'pgt-bjj-dev',FIRESTORE_DATABASE_ID:'(default)',DEV_ACCOUNT_ID:'a'.repeat(32),FIRESTORE_SERVICE_ACCOUNT_JSON:JSON.stringify({type:'service_account',project_id:'pgt-bjj-dev',client_email:'pgt-worker-dev@pgt-bjj-dev.iam.gserviceaccount.com',private_key:'-----BEGIN PRIVATE KEY-----\n'+pk+'\n-----END PRIVATE KEY-----'})};
  const docs=new Map<string,any>(),calls:{url:string;method:string;writes?:number}[]=[];let seq=0,loseAck=false,deny=false;
  const base='https://firestore.googleapis.com/v1/'+DEV_DATABASE_NAME;
  const transport:Transport=async(url,init={})=>{
    const method=init.method||'GET';calls.push({url,method});
    if(url==='https://api.cloudflare.com/client/v4/accounts/'+env.DEV_ACCOUNT_ID+'/workers/scripts/pgt-github-probe-dev/settings')return Response.json({success:true,result:{bindings:[]}});
    if(url==='https://oauth2.googleapis.com/token')return Response.json({access_token:'synthetic-only-token',token_type:'Bearer',expires_in:3600});
    if(!url.startsWith(base))throw Error('Unexpected host/target: '+url);
    if(!new Headers(init.headers).get('Authorization')||deny)return Response.json({error:{code:403,status:'PERMISSION_DENIED'}},{status:403});
    const path=url.slice(base.length);
    if(path==='')return Response.json({name:DEV_DATABASE_NAME,locationId:'europe-west1',databaseEdition:'STANDARD',type:'FIRESTORE_NATIVE'});
    if(path==='/documents:commit'){
      const {writes}=JSON.parse(String(init.body));calls.at(-1)!.writes=writes.length;
      for(const w of writes){const previous=docs.get(w.update?.name||w.delete),p=w.currentDocument;
        if((p?.exists===false&&previous)||(p?.updateTime&&previous?.updateTime!==p.updateTime))return Response.json({error:{code:400,status:'FAILED_PRECONDITION'}},{status:400});
      }
      for(const w of writes){if(w.delete)docs.delete(w.delete);else docs.set(w.update.name,{...structuredClone(w.update),updateTime:`2026-10-20T22:00:${String(Math.floor(++seq/1000000)%60).padStart(2,'0')}.${String(seq%1000000).padStart(6,'0')}Z`});}
      if(loseAck){loseAck=false;throw Error('ACK lost after atomic commit');}
      return Response.json({writeResults:[],commitTime:'fixture'});
    }
    if(path==='/documents:batchGet'){const names=JSON.parse(String(init.body)).documents;return Response.json(names.map((name:string)=>docs.has(name)?{found:docs.get(name)}:{missing:name}).reverse());}
    if(path==='/documents:runQuery'){
      const q=JSON.parse(String(init.body)).structuredQuery,field=q.where.fieldFilter;
      return Response.json([...docs.values()].filter(d=>d.name.startsWith(DEV_DATABASE_NAME+'/documents/'+q.from[0].collectionId+'/')&&d.name.split('/').length===7&&d.fields[field.field.fieldPath]?.stringValue===field.value.stringValue).map(document=>({document})));
    }
    if(path.startsWith('/documents/pgt_changes?'))return Response.json({documents:[...docs.values()].filter(d=>d.name.startsWith(DEV_DATABASE_NAME+'/documents/pgt_changes/')).slice(0,100)});
    const name=DEV_DATABASE_NAME+path;
    return docs.has(name)?Response.json(docs.get(name)):Response.json({error:{code:404,status:'NOT_FOUND'}},{status:404});
  };
  return {env,docs,calls,transport,loseNextAck(){loseAck=true;},denyAccess(){deny=true;}};
}
