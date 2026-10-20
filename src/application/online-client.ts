import {Client,ApiFailure,type Snapshot} from './client-base.ts';
import {db,repository} from '../infrastructure/local.ts';
import type {Document,RemoteRecord,Profile,Comments,Techniques} from '../domain/models.ts';
import {validateProfile,validatePriority,validateTechniques} from '../domain/models.ts';
import {receiveComments} from './comment-notifications.ts';
import {planIssueMessage} from '../domain/plan-issues.ts';

export class OnlineClient extends Client {
  private refresh:Promise<void>|undefined;
  private refreshAgain=false;
  private socket:WebSocket|undefined;
  private socketToken='';
  private opening=false;
  private connectionEpoch=0;
  private retry:ReturnType<typeof setTimeout>|undefined;
  private backoff=500;
  private seen=new Set<string>();
  private writes:Promise<unknown>=Promise.resolve();
  
  private eventRefresh:ReturnType<typeof setTimeout>|undefined;
  constructor(){
    super();
    const channel=new BroadcastChannel('pgt-session');channel.onmessage=()=>this.stop();
    window.addEventListener('storage',e=>{if(e.key==='pgt-session')this.stop();});
    window.addEventListener('offline',()=>{this.stop();this.status='Sin conexión · copia local de consulta';this.onChange();});
    window.addEventListener('focus',()=>{if(this.identity&&!this.locked&&navigator.onLine)void this.sync().catch(()=>{});});
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&this.identity&&!this.locked&&navigator.onLine)void this.sync().catch(()=>{});});
  }
  protected override requestHeaders(){return {'X-PGT-Client':'firestore-dev-v1'};}
  override async request<T=any>(path:string,method='GET',body?:unknown,credential?:string):Promise<T>{
    if(method!=='GET'&&!navigator.onLine)throw Error('Sin conexión. No se ha guardado ningún cambio.');
    try{return await super.request<T>(path,method,body,credential);}
    catch(error){if(error instanceof ApiFailure&&error.status===401)this.stop();throw error;}
  }
  private stop(){
    this.connectionEpoch++;this.opening=false;this.socketToken='';
    clearTimeout(this.retry);clearTimeout(this.eventRefresh);this.retry=undefined;
    const ws=this.socket;this.socket=undefined;if(ws){ws.onclose=null;ws.close();}
  }
  private async connect(){
    if(!this.identity||this.locked||!navigator.onLine)return;
    const identity=this.requireIdentity();
    if(this.socketToken===identity.token&&(this.socket?.readyState===WebSocket.OPEN||this.socket?.readyState===WebSocket.CONNECTING))return;
    if(this.opening)return;
    this.stop();this.opening=true;const epoch=this.connectionEpoch;
    try{
      const value=await this.request<{ticket:string}>('/api/app/realtime-ticket','POST',{});
      if(epoch!==this.connectionEpoch||this.identity?.token!==identity.token||this.locked)return;
      const url=new URL('/api/app/realtime',location.href);url.protocol=url.protocol==='https:'?'wss:':'ws:';url.searchParams.set('ticket',value.ticket);
      const ws=new WebSocket(url);this.socket=ws;this.socketToken=identity.token;
      ws.onmessage=e=>{
        if(epoch!==this.connectionEpoch||this.identity?.token!==identity.token||this.locked)return;
        let event:any;try{event=JSON.parse(e.data);}catch{return;}
        if(!['ready','changed'].includes(event.type)||typeof event.id!=='string'||this.seen.has(event.id))return;
        this.seen.add(event.id);if(this.seen.size>128)this.seen.delete(this.seen.values().next().value!);
        this.backoff=500;this.dayEpoch++;this.viewEpoch++;
        // Handshake precedes the snapshot: a mutation during loading always
        // schedules another authoritative read after that load finishes.
        clearTimeout(this.eventRefresh);this.eventRefresh=setTimeout(()=>void this.sync().then(()=>window.dispatchEvent(new Event('pgt-live-update'))).catch(()=>{}),100);
      };
      ws.onclose=e=>{
        if(epoch!==this.connectionEpoch)return;
        this.socket=undefined;this.socketToken='';
        if(e.code===4401){this.locked=true;this.status='La sesión ha cambiado. Vuelve a entrar.';this.onChange();return;}
        if(!this.identity||this.locked||!navigator.onLine)return;
        this.status='Reconectando · copia local de consulta';this.onChange();
        this.retry=setTimeout(()=>void this.connect(),this.backoff+Math.random()*250);this.backoff=Math.min(this.backoff*2,30000);
      };
    }catch(error){
      if(epoch!==this.connectionEpoch||this.locked||!this.identity)return;
      this.status='No se pudo conectar · copia local de consulta';this.onChange();
      this.retry=setTimeout(()=>void this.connect(),this.backoff+Math.random()*250);this.backoff=Math.min(this.backoff*2,30000);
    }finally{if(epoch===this.connectionEpoch)this.opening=false;}
  }
  override async sync(){
    if(!this.identity||this.locked)return;
    if(!navigator.onLine){this.status='Sin conexión · copia local de consulta';this.onChange();return;}
    if(this.refresh){this.refreshAgain=true;return this.refresh;}
    void this.connect();
    this.refresh=(async()=>{
      do{
        this.refreshAgain=false;const identity=this.requireIdentity();
        try{
          const snapshot=await this.snapshot(identity.mail);this.validate(snapshot);
          if(this.requireIdentity().token!==identity.token)throw Error('Sesión cambiada');
          const entries=this.snapshotEntries(snapshot,identity.mail);
          await db.transaction('rw',db.entries,db.meta,db.commentNotices,async()=>{
            if(this.requireIdentity().token!==identity.token||await repository.owner()!==identity.mail)throw Error('Sesión local incompatible');
            // Preserve legacy drafts for explicit export; never upload them or
            // let a cache entry overwrite the remote source of truth.
            const old=await repository.entries(identity.mail),drafts=old.filter(e=>e.dirty);
            if(drafts.length)await db.meta.put({key:'legacy-drafts:'+identity.mail,value:JSON.stringify({schemaVersion:1,mail:identity.mail,entries:drafts.map(({key,data})=>({key,data}))})});
            await receiveComments(identity.mail,snapshot.comments.data as Comments,snapshot.techniques.data as Techniques,old.find(e=>e.key==='comments')?.data as Comments|undefined);
            await db.entries.clear();await db.entries.bulkPut(entries);
          });
          await this.rememberPlanIssues(identity.mail,snapshot.planIssues);
          const archived=await db.meta.get('legacy-drafts:'+identity.mail);
          this.status=snapshot.planIssues?.length?planIssueMessage(snapshot.planIssues):archived?'Borradores anteriores disponibles para exportar':'Actualizado';
        }catch(error){this.status='No se pudo actualizar: '+(error instanceof Error?error.message:'error');throw error;}
        finally{this.onChange();}
      }while(this.refreshAgain&&this.identity&&!this.locked&&navigator.onLine);
    })().finally(()=>{this.refresh=undefined;});return this.refresh;
  }
  override async login(mail:string,password:string){await super.login(mail,password);await this.sync();}
  override async register(mail:string,password:string,confirm:string,nombre:string,apellidos:string){await super.register(mail,password,confirm,nombre,apellidos);await this.sync();}
  override async edit(key:string,data:Document,expectedVersion?:string|null){
    if(key.startsWith('plan:'))throw Error('PLAN_READ_ONLY');
    if(key==='profile')validateProfile(data as Profile);
    if(key==='techniques')for(const p of (data as Techniques).positions)validatePriority(p.prioridad);
    if(!navigator.onLine)throw Error('Sin conexión. No se ha guardado ningún cambio.');
    const identity=this.requireIdentity();
    // Queue only concurrent online requests already in flight, never durable
    // offline mutations. Each caller receives success only after the server ACK.
    const save=this.writes.catch(()=>{}).then(async()=>{
      if(this.requireIdentity().token!==identity.token||!navigator.onLine)throw Error('La conexión o la sesión ha cambiado. Revisa el borrador antes de guardar.');
      const old=await db.entries.get(key);
      if(!old||old.mail!==identity.mail)throw Error('Datos de otra sesión');
      if(expectedVersion!==undefined&&old.sha!==expectedVersion)throw Error('Los datos han cambiado en otro dispositivo. Conserva el borrador y revisa la versión actual.');
      if(JSON.stringify(old.data)===JSON.stringify(data))return;
      this.status='Guardando…';this.onChange();
      try{
        const saved=await this.request<RemoteRecord>(old.endpoint,'PUT',{data,sha:expectedVersion===undefined?old.sha:expectedVersion});
        this.lastConfirmedRevision.set(key,saved.sha);
        if(this.requireIdentity().token!==identity.token)throw Error('Sesión cambiada');
        await repository.save({...old,data:saved.data,base:structuredClone(saved.data),sha:saved.sha,dirty:false,conflicts:[]},identity.mail);
        await this.sync();
      }catch(error){this.status='No guardado: '+(error instanceof Error?error.message:'error');this.onChange();throw error;}
    });this.writes=save;return save;
  }
  override async importBackup(value:unknown){
    const identity=this.requireIdentity(),b=value as any;
    if(!navigator.onLine)throw Error('Restaurar una copia requiere conexión.');
    if(b?.schemaVersion!==1||b.mail!==identity.mail||!Array.isArray(b.entries)||b.entries.length>200||new Set(b.entries.map((e:any)=>e.key)).size!==b.entries.length)throw Error('Copia no válida o de otro alumno');
    // Validate every importable record before the first remote mutation.
    for(const e of b.entries){if(e.key==='profile'){validateProfile(e.data);if(e.data.mail!==identity.mail||e.data.perfil!==identity.profile.perfil||'pwd' in e.data||'probeOnly' in e.data)throw Error('Perfil de copia no válido');}else if(e.key==='techniques'){validateTechniques(e.data);}else if(!['comments','index'].includes(e.key)&&!e.key?.startsWith('plan:'))throw Error('Archivo no importable');}
    for(const e of b.entries)if(['profile','techniques'].includes(e.key))await this.edit(e.key,e.data);
  }
  override async resolve(){throw Error('No se suben conflictos antiguos. Exporta los borradores y revisa la versión actual antes de guardar.');}
  override async logout(revoked=false){this.stop();await super.logout(revoked);this.status='Sesión cerrada';this.onChange();}
}
