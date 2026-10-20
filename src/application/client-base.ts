import {receiveComments} from "./comment-notifications.ts";
import {planIssueMessage,type PlanIssue} from "../domain/plan-issues.ts";
import {trainerCache,trainerKey,validateTrainerView,type TrainerView,type TrainerSection} from "./trainer-cache.ts";
import {catalogOf, deletedUUIDs, updateFutureDeletions} from "../domain/plan-continuity.ts";
import {MAX_JSON_BYTES, MAX_APP_BODY_BYTES, jsonBytes, documentFile, sizeMessage} from "../domain/json-limits.ts";
import type {
  Profile,
  Comments,
  Document,
  RemoteRecord,
  TrainingPlan,
  Techniques,
} from "../domain/models.ts";
import {
  validateTechniques,
  validatePriority,
  validateVersion,
  validateProfile,
  validatePlan,
} from "../domain/models.ts";
import { db, repository, type LocalEntry } from "../infrastructure/local.ts";
import { merge, resolveRemote } from "../domain/merge.ts";
import {
  madridDate,
  projectFutureDescriptions,
} from "../domain/plan-text-updates.ts";
const API = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
export interface Identity {
  mail: string;
  token: string;
  profile: Profile;
}
export interface Snapshot {
  profile: RemoteRecord<Profile>;
  techniques: RemoteRecord;
  comments: RemoteRecord;
  index: RemoteRecord;
  plans: RemoteRecord<TrainingPlan>[];
  deletedPlanIds: string[];
  planIssues?: PlanIssue[];
}
export interface AuthenticationProvider {
  login(mail: string, password: string): Promise<void>;
  logout(): Promise<void>;
}
export interface SyncService {
  sync(): Promise<void>;
  edit(key: string, data: Document): Promise<void>;
}
export class ApiFailure extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export class Client implements AuthenticationProvider, SyncService {
  private trainerDeniedToken = "";
  private trainerLoads = new Map<string,Promise<TrainerView>>();
  lastConfirmedRevision = new Map<string,string>();
  identity: Identity | null = null;
  locked = false;
  status = "Sin sesión";
  private running: Promise<void> | null = null;
  protected async rememberPlanIssues(mail:string, issues:PlanIssue[] = []) {
    await db.transaction("rw",db.meta,async()=>{
      if(await repository.owner()!==mail)throw Error("Sesión local incompatible");
      await db.meta.put({key:"plan-issues:"+mail,value:JSON.stringify(issues)});
    });
  }
  private channel = new BroadcastChannel("pgt-session");
  onChange: () => void = () => {};
  constructor() {
    const stored = localStorage.getItem("pgt-session");
    if (stored) {
      try {
        this.identity = JSON.parse(stored);
      } catch {
        localStorage.removeItem("pgt-session");
      }
    }
    if(this.identity) {
      const mail=this.identity.mail;
      void db.meta.get("plan-issues:"+mail).then(entry=>{
        if(this.identity?.mail!==mail || this.locked || !entry)return;
        const issues=JSON.parse(entry.value) as PlanIssue[];
        if(issues.length){this.status=planIssueMessage(issues);this.onChange();}
      });
    }
    this.channel.onmessage = () => {
      this.identity = null;
      this.locked = true;
      this.status = "La sesión cambió en otra pestaña. Recarga para continuar.";
      this.onChange();
    };
    window.addEventListener("online", () => {
      void this.sync().catch(() => {});
    });
  }
  protected requireIdentity() {
    const i = this.identity;
    if (
      !i ||
      this.locked ||
      localStorage.getItem("pgt-session") !== JSON.stringify(i)
    )
      throw Error("Sesión cerrada o cambiada");
    return i;
  }
  async request<T = any>(
    path: string,
    method = "GET",
    body?: unknown,
    credential?: string,
  ): Promise<T> {
    const token =
      credential === undefined ? this.requireIdentity().token : credential;
    if (method === "PUT" && body && typeof body === "object" && "data" in body) {
      const bytes = jsonBytes((body as {data: unknown}).data);
      if (bytes > MAX_JSON_BYTES) throw new ApiFailure(413, sizeMessage({file: documentFile(path), bytes, limitBytes: MAX_JSON_BYTES, scope: "document"}));
    }
    const serialized = body ? JSON.stringify(body) : undefined;
    if (serialized && new TextEncoder().encode(serialized).length > MAX_APP_BODY_BYTES)
      throw new ApiFailure(413, sizeMessage({file: documentFile(path), bytes: new TextEncoder().encode(serialized).length, limitBytes: MAX_APP_BODY_BYTES, scope: "request"}));
    const response = await fetch(API + path, {
      method,
      headers: {
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: serialized,
      cache: "no-store",
    });
    const value = (await response.json()) as any;
    if (!response.ok) {
      if (response.status === 401 && credential === undefined && this.identity?.token === token) {
        if(this.identity)await trainerCache.clear(this.identity.mail);
        this.locked = true;
        this.status = "La sesión remota fue revocada. Vuelve a entrar.";
        this.onChange();
      }
      throw new ApiFailure(response.status, value.size ? sizeMessage(value.size) : value.error || "Error de API");
    }
    if(method==="POST" && ["/api/app/assignment","/api/app/competition","/api/app/delete-competition"].includes(path) && this.identity?.token===token && !this.locked){
      this.dayEpoch++;
      await db.trainerDays.where("owner").equals(this.identity.mail).delete();
    }
    return value as T;
  }
  async login(mail: string, password: string) {
    await this.authenticate("/api/app/login", { mail, password });
  }
  async register(
    mail: string,
    password: string,
    confirm: string,
    nombre: string,
    apellidos: string,
  ) {
    await this.authenticate("/api/app/register", {
      mail,
      password,
      confirm,
      nombre,
      apellidos,
    });
  }
  private async authenticate(path: string, body: any) {
    if (!navigator.onLine)
      throw Error("La primera carga y el cambio de usuario requieren conexión");
    const owner = await repository.owner(),
      pending = (await db.entries.toArray()).some((e) => e.dirty);
    const reopening =
      pending && owner === String(body.mail).trim().toLowerCase();
    if (pending && !reopening) {
      if (!this.identity || this.locked)
        throw Error(
          "Hay cambios pendientes del usuario anterior. Reabre su sesión para sincronizar antes de cambiar.",
        );
      await this.sync();
      if ((await db.entries.toArray()).some((e) => e.dirty))
        throw Error("No se puede cambiar de usuario con cambios pendientes");
    }
    const auth = await this.request<{ token: string; profile: Profile }>(
      path,
      "POST",
      body,
      "",
    );
    const identity = {
      mail: auth.profile.mail,
      token: auth.token,
      profile: auth.profile,
    };
    this.identity = null;
    this.locked = true;
    localStorage.removeItem("pgt-session");
    this.channel.postMessage("restoring");
    this.onChange();
    // Download/validate in memory, then atomically replace only after successful restoration.
    const snapshot = await this.request<Snapshot>(
      `/api/app/users/${encodeURIComponent(identity.mail)}/snapshot`,
      "GET",
      undefined,
      identity.token,
    );
    this.validate(snapshot);
    if (snapshot.profile.data.mail !== identity.mail)
      throw Error("Restauración de otro usuario");
    const entries = this.snapshotEntries(snapshot, identity.mail);
    if (!reopening)
      await db.transaction("rw", db.entries, db.meta, db.commentNotices, async () => {
        const previous = owner === identity.mail ? (await db.entries.get("comments"))?.data as Comments | undefined : undefined;
        await receiveComments(identity.mail,snapshot.comments.data as Comments,snapshot.techniques.data as Techniques,previous);
        await db.entries.clear();
        await db.entries.bulkPut(entries);
        await db.meta.clear();
        await db.meta.put({ key: "owner", value: identity.mail });
      });
    await this.rememberPlanIssues(identity.mail,snapshot.planIssues);
    this.identity = identity;
    this.locked = false;
    localStorage.setItem("pgt-session", JSON.stringify(identity));
    this.channel.postMessage("session-changed");
    this.status = snapshot.planIssues?.length ? planIssueMessage(snapshot.planIssues) :
      owner && owner !== identity.mail
        ? "Usuario restaurado"
        : "Sesión iniciada";
    this.onChange();
    if (reopening) await this.sync();
  }
  protected validate(s: Snapshot) {
    if (
      !s.profile ||
      !s.techniques ||
      !s.comments ||
      !s.index ||
      !Array.isArray(s.plans)
    )
      throw Error("Restauración incompleta");
    if(s.planIssues!==undefined && (!Array.isArray(s.planIssues) || s.planIssues.some(issue=>
      !issue || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(issue.planId) ||
      !["PLAN_TOO_LARGE","NO_TRAINABLE_TECHNIQUES"].includes(issue.code) ||
      (issue.code==="PLAN_TOO_LARGE" && (!issue.size || issue.size.file!==`plan_${issue.planId}.json` ||
       !Number.isSafeInteger(issue.size.bytes) || issue.size.bytes<=MAX_JSON_BYTES || issue.size.limitBytes!==MAX_JSON_BYTES)))))
      throw Error("Estado de planes inválido");
    validateProfile(s.profile.data);
    if ("pwd" in s.profile.data || "probeOnly" in s.profile.data)
      throw Error("Perfil remoto contiene campos privados");
    validateTechniques(s.techniques.data);
    for (const r of [s.profile, s.comments, s.index, ...s.plans])
      validateVersion(r.data);
    for (const r of s.plans) {
      validatePlan(r.data);
      if (r.data.mail !== s.profile.data.mail)
        throw Error("Plan de otro usuario");
    }
  }
  protected snapshotEntries(s: Snapshot, mail: string): LocalEntry[] {
    const endpoint = `/api/app/users/${encodeURIComponent(mail)}/`;
    const map = (key: string, r: RemoteRecord, path: string) =>
      ({
        key,
        mail,
        data: r.data,
        base: structuredClone(r.data),
        sha: r.sha,
        dirty: false,
        endpoint: endpoint + path,
        conflicts: [],
      }) as LocalEntry;
    return [
      map("profile", s.profile, "profile"),
      map("techniques", s.techniques, "techniques"),
      map("comments", s.comments, "comments"),
      map("index", s.index, "index"),
      ...s.plans.map((r) => map("plan:" + r.data.planId, r, "plan")),
    ];
  }
  protected async snapshot(mail: string): Promise<Snapshot> {
    const cached = await repository.entries(mail);
    const byKey = new Map(cached.map((e) => [e.key, e]));
    const known = Object.fromEntries(
      cached.filter((e) => e.sha).map((e) => [e.key, e.sha]),
    );
    const raw = await this.request<any>(
      `/api/app/users/${encodeURIComponent(mail)}/snapshot?known=${encodeURIComponent(JSON.stringify(known))}`,
    );
    const restore = (key: string, r: any) => {
      if (!r?.unchanged) return r;
      const e = byKey.get(key);
      if (!e || e.sha !== r.sha) throw Error("Versión local no disponible");
      return { data: structuredClone(e.base), sha: r.sha };
    };
    return {
      ...raw,
      profile: restore("profile", raw.profile),
      techniques: restore("techniques", raw.techniques),
      comments: restore("comments", raw.comments),
      index: restore("index", raw.index),
      plans: raw.plans.map((r: any) =>
        restore("plan:" + (r.planId || r.data?.planId), r),
      ),
    };
  }
  private async trainerIdentity() {
    const identity=this.requireIdentity();
    const entry=await db.entries.get("profile");
    if(this.requireIdentity().token!==identity.token)throw Error("Sesión cambiada");
    // The last confirmed profile may be newer than the profile captured at login.
    const profile=entry?.mail===identity.mail&&(entry.base as Profile)?.mail===identity.mail ? entry.base as Profile : identity.profile;
    if(this.trainerDeniedToken===identity.token || profile.perfil!=="entrenador"){
      await trainerCache.clear(identity.mail);
      throw Error("Solo entrenadores pueden consultar fichas");
    }
    return identity;
  }
  async cachedTrainer(mail:string,section:TrainerSection,planId=""):Promise<TrainerView|undefined> {
    const identity=await this.trainerIdentity();
    const entry=await trainerCache.get(identity.mail,mail,section,planId);
    if(this.requireIdentity().token!==identity.token)throw Error("Sesión cambiada");
    return entry ? this.overlayTrainerLocal(entry.data,mail) : undefined;
  }
  private async overlayTrainerLocal(view:TrainerView,mail:string):Promise<TrainerView> {
    if(this.requireIdentity().mail!==mail)return view;
    const entries=await repository.entries(mail);
    const local=new Map(entries.filter(e=>e.dirty).map(e=>[e.key,e]));
    return {...view,
      profile:local.has("profile")?{data:local.get("profile")!.data as Profile,sha:local.get("profile")!.sha!}:view.profile,
      techniques:view.techniques&&local.has("techniques")?{data:local.get("techniques")!.data as Techniques,sha:local.get("techniques")!.sha!}:view.techniques,
      plans:view.plans?.map(p=>{const e=entries.find(e=>e.key==="plan:"+p.data.planId);return e && (e.dirty || local.has("techniques") || local.has("comments") || e.data.revision>p.data.revision) ? {data:e.data as TrainingPlan,sha:e.sha!}:p;}),
    };
  }
  protected dayEpoch=0;
  protected viewEpoch=0;
  private dayLoads = new Map<string,Promise<import("../domain/trainer-reports.ts").TrainingDay>>();
  async cachedTrainingDay(date:string) {
    const identity=await this.trainerIdentity();
    const key=JSON.stringify([identity.mail,date||"next:"+madridDate()]);
    const entry=await db.trainerDays.get(key);
    if(this.requireIdentity().token!==identity.token)throw Error("Sesión cambiada");
    return entry?.data;
  }
  async trainingDay(date:string):Promise<import("../domain/trainer-reports.ts").TrainingDay> {
    const identity=await this.trainerIdentity(),epoch=this.dayEpoch,key=JSON.stringify([identity.mail,date||"next:"+madridDate()]),requestKey=key+identity.token+":"+epoch;
    const pending=this.dayLoads.get(requestKey);if(pending)return pending;
    const load=(async()=>{
      if(!navigator.onLine){const cached=await this.cachedTrainingDay(date);if(cached)return cached;throw Error("Sin conexión y sin copia de los entrenamientos de esta fecha");}
      try {
        const path="/api/app/training-day?date="+encodeURIComponent(date);
        let data=await this.request<import("../domain/trainer-reports.ts").TrainingDay>(path);
        if(data.missing>0)data=await this.request<import("../domain/trainer-reports.ts").TrainingDay>(path,"POST",{});
        if(this.requireIdentity().token!==identity.token)throw Error("Sesión cambiada");
        if(epoch!==this.dayEpoch)throw Error("Las competiciones han cambiado. Actualiza el entrenamiento del día.");
        if(!data||!Array.isArray(data.groups)||!Array.isArray(data.dates)||typeof data.date!=="string")throw Error("Respuesta de entrenamientos no válida");
        await db.transaction("rw",db.trainerDays,async()=>{
          if(this.requireIdentity().token!==identity.token)throw Error("Sesión cambiada");
          if(epoch!==this.dayEpoch)throw Error("Las competiciones han cambiado. Actualiza el entrenamiento del día.");
          await db.trainerDays.put({key,owner:identity.mail,data});
        });
        return data;
      }catch(error){if(error instanceof ApiFailure&&error.status===403&&this.identity?.token===identity.token){this.trainerDeniedToken=identity.token;await trainerCache.clear(identity.mail);}throw error;}
    })();this.dayLoads.set(requestKey,load);try{return await load;}finally{this.dayLoads.delete(requestKey);}
  }
  async trainerView(mail:string,section:TrainerSection,force=false,planId=""):Promise<TrainerView> {
    const identity=await this.trainerIdentity(),epoch=this.viewEpoch,key=trainerKey(identity.mail,mail,section,planId),requestKey=key+identity.token+":"+epoch;
    const pending=this.trainerLoads.get(requestKey);
    if(pending){if(!force)return pending;await pending.catch(()=>{});if(this.requireIdentity().token!==identity.token)throw Error("Sesión cambiada");}
    const load=(async()=>{
      const cached=await trainerCache.get(identity.mail,mail,section,planId);
      if(!navigator.onLine){if(cached)return this.overlayTrainerLocal(cached.data,mail);throw Error("Sin conexión y sin copia disponible de esta sección");}
      const known:Record<string,string>={};
      for(const [name,r] of Object.entries(cached?.data||{}))if(r&&!Array.isArray(r)&&name!=="planSummaries")known[name]=(r as RemoteRecord).sha;
      for(const r of cached?.data.plans||[])known["plan:"+r.data.planId]=r.sha;
      let raw:any;
      try {raw=await this.request<any>(`/api/app/users/${encodeURIComponent(mail)}/view?section=${section}&planId=${planId}&known=${encodeURIComponent(JSON.stringify(known))}`);}
      catch(error){if(error instanceof ApiFailure&&error.status===403&&this.identity?.token===identity.token){this.trainerDeniedToken=identity.token;await trainerCache.clear(identity.mail);}throw error;}
      const restore=(name:string,r:any)=>r?.unchanged ? (cached?.data as any)?.[name] : r;
      const data:TrainerView={profile:restore("profile",raw.profile)};
      if(section==="techniques"){data.techniques=restore("techniques",raw.techniques);data.comments=restore("comments",raw.comments);}
      if(section==="plans"){data.planSummaries=raw.planSummaries;data.plans=raw.plans.map((r:any)=>r.unchanged?cached?.data.plans?.find(p=>p.data.planId===r.planId&&p.sha===r.sha):r);}
      validateTrainerView(data,mail,section);
      await db.transaction("rw",db.trainerViews,async()=>{
        if(this.requireIdentity().token!==identity.token)throw Error("Sesión cambiada; ficha descartada");
        if(epoch!==this.viewEpoch)return;
        await db.trainerViews.put({key,owner:identity.mail,mail,section,data,checkedAt:Date.now()});
      });
      return this.overlayTrainerLocal(data,mail);
    })();
    this.trainerLoads.set(requestKey,load);
    try{return await load;}finally{if(this.trainerLoads.get(requestKey)===load)this.trainerLoads.delete(requestKey);}
  }
  async load() {
    if (!this.identity || this.locked) return [];
    return repository.entries(this.identity.mail);
  }
  async edit(key: string, data: Document, expectedVersion?:string|null) {
    const identity = this.requireIdentity();
    if (key.startsWith("plan:")) throw Error("PLAN_READ_ONLY");
    if (key === "profile") validateProfile(data as Profile);
    if (key === "techniques")
      for (const position of (data as Techniques).positions) validatePriority(position.prioridad);
    const old = await db.entries.get(key);
    if (!old || old.mail !== identity.mail) throw Error("Datos de otra sesión");
    this.requireIdentity();
    if (JSON.stringify(old.data) === JSON.stringify(data)) return;
    await db.transaction("rw", db.entries, db.meta, async () => {
      await repository.save(
        { ...old, data: structuredClone(data), dirty: true, conflicts: [] },
        identity.mail,
      );
      if (key === "techniques") {
        for (const entry of await repository.entries(identity.mail)) {
          if (
            !entry.key.startsWith("plan:") ||
            (entry.data as TrainingPlan).mail !== identity.mail
          )
            continue;
          const incoming = {...data as Techniques, deletionRevision:((old.data as Techniques).deletionRevision || 0) + Number(deletedUUIDs(old.data as Techniques, data as Techniques).length > 0), deletionCatalog:(old.data as Techniques).deletionCatalog || catalogOf(old.data as Techniques), deletedIds:[...new Set([...(old.data as Techniques).deletedIds || [], ...deletedUUIDs(old.data as Techniques, data as Techniques)])]};
          const projected = projectFutureDescriptions(
            updateFutureDeletions(entry.data as TrainingPlan, incoming, (await db.entries.get("comments"))!.data as Comments, madridDate()),
            old.data as Techniques,
            data as Techniques,
            madridDate(),
          );
          if (projected !== entry.data)
            await repository.save({ ...entry, data: projected }, identity.mail);
        }
      }
    });
    this.status = "Cambios guardados en este dispositivo · pendientes de sincronizar";
    this.onChange();
  }
  async sync() {
    if (this.running) return this.running;
    this.running = this.performSync().finally(() => {
      this.running = null;
    });
    return this.running;
  }
  private async performSync() {
    const identity = this.requireIdentity();
    if (!navigator.onLine) {
      this.status = "Sin conexión · cambios conservados localmente";
      this.onChange();
      return;
    }
    this.status = "Sincronizando…";
    this.onChange();
    try {
      let snapshot = await this.snapshot(identity.mail);
      this.validate(snapshot);
      const remote = this.snapshotEntries(snapshot, identity.mail);
      const byKey = new Map(remote.map((e) => [e.key, e]));
      for (const entry of (await repository.entries(identity.mail)).sort(
        (a, b) =>
          Number(a.key !== "techniques") - Number(b.key !== "techniques"),
      )) {
        this.requireIdentity();
        if (!entry.dirty) continue;
        const current = byKey.get(entry.key);
        if (!current) {
          if (
            entry.key.startsWith("plan:") &&
            snapshot.deletedPlanIds.includes(entry.key.slice(5))
          ) {
            entry.conflicts = ["El entrenador ha eliminado este plan"];
            entry.remote = undefined;
            await repository.save(entry, identity.mail);
            continue;
          }
          throw Error(
            "Recurso remoto desaparecido; cambios locales conservados",
          );
        }
        if (entry.key.startsWith("plan:")) {
          // Preserve legacy pending drafts for export; never upload manual plan changes.
          await repository.save(
            {
              ...entry,
              conflicts: ["/"],
              remote: { data: current.data, sha: current.sha! },
            },
            identity.mail,
          );
          continue;
        }
        const merged = merge(entry.base, entry.data, current.data);
        if (merged.conflicts.length) {
          await db.transaction("rw", db.entries, db.meta, async () => {
            this.requireIdentity();
            const latest = await db.entries.get(entry.key);
            if (!latest?.dirty) return;
            const result = merge(latest.base, latest.data, current.data);
            await repository.save(
              {
                ...latest,
                data: result.value,
                conflicts: result.conflicts,
                remote: { data: current.data, sha: current.sha! },
              },
              identity.mail,
            );
          });
          continue;
        }
        const saved = await this.request<RemoteRecord & {planIssues?:PlanIssue[]}>(entry.endpoint, "PUT", {
          data: merged.value,
          sha: current.sha,
        });
        this.requireIdentity();
        if(saved.planIssues)await this.rememberPlanIssues(identity.mail,saved.planIssues);
        await db.transaction("rw", db.entries, db.meta, async () => {
          const latest = await db.entries.get(entry.key);
          if (!latest || latest.mail !== identity.mail)
            throw Error("Sesión local incompatible");
          const changed =
            JSON.stringify(latest.data) !== JSON.stringify(entry.data);
          const next = changed
            ? merge(entry.data, latest.data, saved.data)
            : { value: saved.data, conflicts: [] };
          await repository.save(
            {
              ...latest,
              data: next.value,
              base: structuredClone(saved.data),
              sha: saved.sha,
              dirty: changed,
              conflicts: next.conflicts,
              remote: next.conflicts.length ? saved : undefined,
            },
            identity.mail,
          );
        });
        if (entry.key === "techniques") {
          const refreshed = await this.snapshot(identity.mail);
          this.validate(refreshed);
          for (const e of this.snapshotEntries(refreshed, identity.mail))
            byKey.set(e.key, e);
        }
      }
      snapshot = await this.snapshot(identity.mail);
      this.validate(snapshot);
      for (const fresh of this.snapshotEntries(snapshot, identity.mail)) {
        this.requireIdentity();
        await db.transaction("rw", db.entries, db.meta, db.commentNotices, async () => {
          this.requireIdentity();
          if ((await repository.owner()) !== identity.mail) throw Error("Sesión local incompatible");
          const local = await db.entries.get(fresh.key);
          if (!local?.dirty) {
            if (fresh.key === "comments") await receiveComments(identity.mail,snapshot.comments.data as Comments,snapshot.techniques.data as Techniques,local?.data as Comments | undefined);
            await repository.save(fresh, identity.mail);
          }
        });
      }
      for (const id of snapshot.deletedPlanIds) {
        await db.transaction("rw", db.entries, db.meta, async () => {
          this.requireIdentity();
          if ((await repository.owner()) !== identity.mail)
            throw Error("Sesión local incompatible");
          const local = await db.entries.get("plan:" + id);
          if (local && !local.dirty) await db.entries.delete(local.key);
        });
      }
      const remaining = (await repository.entries(identity.mail)).filter(
        (e) => e.dirty,
      );
      const blocked = (await repository.entries(identity.mail)).filter(e=>e.key.startsWith("plan:") && (e.data as TrainingPlan).structuralUpdateError);
      await this.rememberPlanIssues(identity.mail,snapshot.planIssues);
      this.status = snapshot.planIssues?.length ? planIssueMessage(snapshot.planIssues) : blocked.length ? `Sincronización incompleta: ${blocked.length} plan(es) con actualización bloqueada; revisa el aviso del plan` : remaining.length
        ? `${remaining.length} archivo(s) pendientes; revisa conflictos`
        : "Sincronizado";
    } catch (error) {
      this.status =
        "Sincronización incompleta: " +
        (error instanceof Error ? error.message : "error");
      throw error;
    } finally {
      this.onChange();
    }
  }
  async importBackup(value: unknown) {
    const identity = this.requireIdentity();
    const b = value as any;
    if (
      !b ||
      b.schemaVersion !== 1 ||
      b.mail !== identity.mail ||
      !Array.isArray(b.entries) ||
      b.entries.length > 200 ||
      new Set(b.entries.map((e: any) => e?.key)).size !== b.entries.length
    )
      throw Error("Copia no válida o de otro alumno");
    const existing = new Map(
      (await repository.entries(identity.mail)).map((e) => [e.key, e]),
    );
    const pending: { key: string; data: Document }[] = [];
    for (const e of b.entries) {
      if (!e || typeof e.key !== "string") throw Error("Entrada no válida");
      if (["comments", "index"].includes(e.key)) continue;
      if (!existing.has(e.key))
        throw Error(
          "El archivo no existe en la sesión; no se resucitan planes borrados",
        );
      if (e.key === "techniques") validateTechniques(e.data);
      else if (e.key === "profile") {
        validateProfile(e.data);
        if (
          e.data.mail !== identity.mail ||
          e.data.perfil !== identity.profile.perfil ||
          "pwd" in e.data ||
          "probeOnly" in e.data
        )
          throw Error("Perfil de copia no válido");
      } else if (e.key.startsWith("plan:")) {
        validatePlan(e.data);
        if (e.data.mail !== identity.mail || e.key !== "plan:" + e.data.planId)
          throw Error("Plan de otro alumno");
        continue; // plans in backups are reference snapshots, not importable edits
      } else throw Error("Archivo no importable");
      pending.push(e);
    }
    this.requireIdentity();
    await db.transaction("rw", db.entries, db.meta, async () => {
      for (const e of pending) {
        const old = await db.entries.get(e.key);
        if (!old) throw Error("Restauración incompleta");
        await repository.save(
          { ...old, data: structuredClone(e.data), dirty: true, conflicts: [] },
          identity.mail,
        );
      }
    });
    this.status =
      "Perfil y técnicas importados como cambios pendientes; planes de solo lectura";
    this.onChange();
  }
  async resolve(key: string, choice: "local" | "remote") {
    const identity = this.requireIdentity();
    const entry = await db.entries.get(key);
    if (!entry) throw Error("No hay conflicto");
    if (key.startsWith("plan:") && choice === "local")
      throw Error("PLAN_READ_ONLY");
    if (!entry.remote) {
      if (
        choice === "remote" &&
        entry.key.startsWith("plan:") &&
        entry.conflicts.includes("El entrenador ha eliminado este plan")
      ) {
        await db.transaction("rw", db.entries, db.meta, async () => {
          this.requireIdentity();
          if ((await repository.owner()) !== identity.mail)
            throw Error("Sesión local incompatible");
          await db.entries.delete(entry.key);
        });
        this.onChange();
        return;
      }
      throw Error(
        "El plan fue eliminado. Exporta tu copia antes de descartar; no se puede resucitar en GitHub",
      );
    }
    const r = entry.remote;
    const data =
      choice === "remote"
        ? resolveRemote(entry.data, r.data, entry.conflicts)
        : entry.data;
    const dirty=JSON.stringify(data)!==JSON.stringify(r.data);
    await repository.save(
      {
        ...entry,
        data,
        base: r.data,
        sha: r.sha,
        dirty,
        conflicts: [],
        remote: undefined,
      },
      identity.mail,
    );
    if(dirty)this.status = "Datos pendientes de sincronizar";
    this.onChange();
  }
  async logout(revoked = false) {
    const identity = this.identity;
    if (!identity) throw Error("No hay sesión");
    // Lock immediately, retain local business data and queue. Remote token revoked best-effort.
    this.locked = true;
    this.onChange();
    await trainerCache.clear(identity.mail);
    try {
      if (navigator.onLine && !revoked)
        await this.request("/api/app/logout", "POST", {}, identity.token);
    } finally {
      localStorage.removeItem("pgt-session");
      this.identity = null;
      this.channel.postMessage("logout");
      this.status = "Sesión cerrada; los cambios pendientes se conservan";
      this.onChange();
    }
  }
}

