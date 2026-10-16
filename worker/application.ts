import {readTrainingDay} from "./training-day.ts";
import type {PlanIssue} from "../src/domain/plan-issues.ts";
import {catalogOf, deletedUUIDs, updateFutureDeletions} from "../src/domain/plan-continuity.ts";
import {MAX_APP_BODY_BYTES, MAX_TEXT_LENGTH} from "../src/domain/json-limits.ts";
import {
  ApiError,
  reject,
  normalizedMail,
  passwordHash,
  passwordMatches,
  opaqueToken,
  fingerprint,
  jsonBody,
  onlyFields,
} from "./security.ts";
import type { CloudStorageProvider, CloudRecord } from "./storage.ts";
import {
  cloneTemplate,
  initialVersion,
  now,
  validateTechniques,
  validateVersion,
  validateProfile,
  validateCompetition,
  type Profile,
  type Template,
  type Techniques,
  type Comments,
  type Index,
  type Catalog,
  type Competition,
  type TrainingPlan,
} from "../src/domain/models.ts";
import {
  madridDate,
  descriptionChanges,
  commentChanges,
  updateTextVersions,
  updateFuturePlanText,
} from "../src/domain/plan-text-updates.ts";
import { generatePlan } from "../src/domain/planner.ts";
type Session = { mail: string; pwdFingerprint: string };
const root = (mail: string) => `PGT/users_data/${mail}`;
const profilePath = (mail: string) => `${root(mail)}/user_data.json`;
function clean(profile: Profile) {
  const { pwd, probeOnly, ...safe } = profile;
  return safe;
}
const unchanged = (a: unknown, b: unknown) => {
  const strip = (v: any) => {
    const { revision, updatedAt, ...data } = v;
    return data;
  };
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
};
const respond = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
async function concurrentMap<T,R>(values:T[],fn:(value:T)=>Promise<R>,limit=4):Promise<R[]> {
  const result:R[]=new Array(values.length);let index=0;
  await Promise.all(Array.from({length:Math.min(limit,values.length)},async()=>{for(;;){const i=index++;if(i>=values.length)return;result[i]=await fn(values[i]);}}));
  return result;
}
export class AppApi {
  constructor(
    privateStore: DurableObjectStorage,
    cloud: CloudStorageProvider,
    clock: () => Date = () => new Date(),
  ) {
    this.store = privateStore;
    this.cloud = cloud;
    this.clock = clock;
  }
  private store: DurableObjectStorage;
  private cloud: CloudStorageProvider;
  private clock: () => Date;
  private async profile(mail: string) {
    const p = await this.cloud.read<Profile>(profilePath(mail));
    if (!p || !p.data.pwd) return reject(404, "USER_NOT_FOUND");
    return p;
  }
  private async session(
    request: Request,
  ): Promise<{ session: Session; profile: CloudRecord<Profile> }> {
    const token = request.headers
      .get("Authorization")
      ?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    if (!token) return reject(401, "SESSION_REQUIRED");
    const s = await this.store.get<Session>(
      "app-session:" + (await fingerprint(token)),
    );
    if (!s) return reject(401, "SESSION_REVOKED");
    const p = await this.profile(s.mail);
    if (s.pwdFingerprint !== (await fingerprint(p.data.pwd!))) {
      await this.store.delete("app-session:" + (await fingerprint(token)));
      return reject(401, "SESSION_REVOKED");
    }
    return { session: s, profile: p };
  }
  private async trainer(request: Request) {
    const s = await this.session(request);
    if (s.profile.data.perfil !== "entrenador")
      return reject(403, "TRAINER_REQUIRED");
    return s;
  }
  private async createOnly(path: string, data: unknown) {
    const exists = await this.cloud.read(path);
    if (!exists) await this.cloud.write(path, data, null);
  }
  private async initialize(mail: string) {
    const base = await this.cloud.read<Template>(
      "PGT/master_data/tecnics_base.json",
    );
    if (!base) return reject(503, "OFFICIAL_TEMPLATE_REQUIRED");
    await this.createOnly(
      `${root(mail)}/tecnics.json`,
      cloneTemplate(base.data),
    );
    await this.createOnly(`${root(mail)}/trainer_comments.json`, {
      ...initialVersion(),
      comments: [],
    });
    await this.createOnly(`${root(mail)}/plans_index.json`, {
      ...initialVersion(),
      planIds: [],
    });
  }
  private async mint(p: Profile) {
    const token = opaqueToken();
    await this.store.put("app-session:" + (await fingerprint(token)), {
      mail: p.mail,
      pwdFingerprint: await fingerprint(p.pwd!),
    });
    return token;
  }
  private async checkSha(path: string, sha: unknown) {
    const current = await this.cloud.read(path);
    if (sha !== (current?.sha ?? null)) return reject(409, "VERSION_CONFLICT");
    return current;
  }
  private async revoke(mail: string) {
    for (const [key, s] of await this.store.list<Session>({
      prefix: "app-session:",
    }))
      if (s.mail === mail) await this.store.delete(key);
  }
  private async updatePlanTexts(mail: string,onlyPlanId?:string, issues?:PlanIssue[]) {
    const loaded=new Map<string,CloudRecord<TrainingPlan>>();
    const [metadata,files]=await Promise.all([this.cloud.list?.(root(mail)),this.cloud.list?.(`${root(mail)}/training_plans`)]);
    const planFiles=(files||[]).filter(f=>(!onlyPlanId||f.name===`plan_${onlyPlanId}.json`)&&f.type==="file"&&/^plan_[0-9a-f-]{36}\.json$/.test(f.name));
    const today=madridDate(this.clock());
    const tSha=metadata?.find(f=>f.name==="tecnics.json")?.sha,cSha=metadata?.find(f=>f.name==="trainer_comments.json")?.sha;
    const pending=(await Promise.all(planFiles.map(async file=>{
      const marker=await this.store.get<{t:string;c:string;p:string;day:string}>(`plan-update:${mail}:${file.name}`);
      return file.sha&&tSha&&cSha&&marker?.t===tSha&&marker.c===cSha&&marker.p===file.sha&&marker.day===today ? null : file;
    }))).filter((file):file is NonNullable<typeof file>=>file!==null);
    if(!pending.length)return loaded;
    const [techniques,comments]=await Promise.all([this.cloud.read<Techniques>(`${root(mail)}/tecnics.json`),this.cloud.read<Comments>(`${root(mail)}/trainer_comments.json`)]);
    if(!techniques||!comments)return loaded;
    await concurrentMap(pending,async file=>{
      const key=`plan-update:${mail}:${file.name}`;
      const mark=(sha:string,t=techniques,c=comments)=>this.store.put(key,{t:t.sha,c:c.sha,p:sha,day:today});
      if(!techniques.data.descriptionUpdates&&!comments.data.commentUpdates&&!techniques.data.deletedIds?.length){if(file.sha)await mark(file.sha);return;}
      const path=`${root(mail)}/training_plans/${file.name}`;
      for(let attempt=0;attempt<3;attempt++){
        const current=await this.cloud.read<TrainingPlan>(path);
        if(!current||current.data.mail!==mail)return;
        loaded.set(file.name,current);
        if(current.data.fecha_torneo<=today){await mark(current.sha);return;}
        const [t,c]=attempt ? await Promise.all([this.cloud.read<Techniques>(`${root(mail)}/tecnics.json`),this.cloud.read<Comments>(`${root(mail)}/trainer_comments.json`)]) : [techniques,comments];
        if(!t||!c)return;
        const next=updateFuturePlanText(updateFutureDeletions(current.data,t.data,c.data,today),t.data,c.data,today);
        if(next===current.data){await mark(current.sha,t,c);return;}
        try {const data={...next,revision:current.data.revision+1,updatedAt:now()};const sha=await this.cloud.write(path,data,current.sha);loaded.set(file.name,{data,sha});await mark(sha,t,c);return;}
        catch(error){
          if(issues && error instanceof ApiError && error.status===413 && error.message==="JSON_TOO_LARGE" && error.size?.file===file.name){
            issues.push({planId:file.name.slice(5,-5),code:"PLAN_TOO_LARGE",size:error.size});return;
          }
          if(!(error instanceof ApiError)||![409,422].includes(error.status)||attempt===2)throw error;
        }
      }
    });
    return loaded;
  }
  private async reconcile(onlyMail?: string) {
    // The catalog is the authority for assignments/deletions; incomplete multi-file writes
    // are replayable on the next sync, without storing business records in the DO.
    const catalog = await this.cloud.read<Catalog>(
      "PGT/master_data/plans.json",
    );
    if (!catalog) return;
    for (const entry of onlyMail
      ? [{ name: onlyMail, type: "dir" }]
      : (await this.cloud.list?.("PGT/users_data")) || []) {
      if (entry.type !== "dir") continue;
      let mail: string;
      try {
        mail = normalizedMail(entry.name);
      } catch {
        continue;
      }
      if (onlyMail && mail !== onlyMail) continue;
      const profile = await this.cloud.read<Profile>(profilePath(mail));
      if (!profile || profile.data.probeOnly) continue;
      const path = `${root(mail)}/plans_index.json`,
        current = await this.cloud.read<Index>(path);
      const ids = catalog.data.plans
        .filter((p) => p.alumnos.includes(mail))
        .map((p) => p.planId);
      const storedPlans = (await this.cloud.list?.(`${root(mail)}/training_plans`)) || [];
      const removed = [...new Set([
        ...(current?.data.deletedPlanIds || []),
        ...(current?.data.planIds || []).filter(id => !ids.includes(id)),
        ...storedPlans.filter(file => file.type === 'file' && /^plan_[0-9a-f-]{36}\.json$/.test(file.name))
          .map(file => file.name.slice(5,-5)).filter(id => !ids.includes(id)),
        ...storedPlans.filter(file=>file.type==='file' && /^structure_[0-9a-f-]{36}\.json$/.test(file.name)).map(file=>file.name.slice(10,-5)).filter(id=>!ids.includes(id)),
        ...catalog.data.deletedPlanIds,
      ])].filter(id => !ids.includes(id));
      if (JSON.stringify(current?.data.planIds || []) !== JSON.stringify(ids) ||
          JSON.stringify(current?.data.deletedPlanIds || []) !== JSON.stringify(removed))
        await this.cloud.write(path, {
          ...initialVersion(), revision: (current?.data.revision || 0) + 1,
          planIds: ids, deletedPlanIds: removed,
        }, current?.sha || null);
      // Persist per-user tombstones before removing files: offline devices and retries
      // must still learn about a deletion after the remote file has disappeared.
      for (const id of removed) {
        const planPath = `${root(mail)}/training_plans/plan_${id}.json`;
        const old = await this.cloud.read(planPath);
        if (old) await this.cloud.remove(planPath, old.sha);
        if(storedPlans.some(f=>f.name===`structure_${id}.json`)) {
          const derivedPath=`${root(mail)}/training_plans/structure_${id}.json`;
          const derived=await this.cloud.read(derivedPath);
          if(derived)await this.cloud.remove(derivedPath,derived.sha);
        }
      }
    }
  }
  async handle(request: Request, url: URL): Promise<Response> {
    const route = `${request.method} ${url.pathname}`;
    if (url.pathname === "/api/app/bootstrap") return reject(404, "ENDPOINT_NOT_FOUND");
    const validate = (fn: () => void) => {
      try {
        fn();
      } catch {
        return reject(400, "PAYLOAD_INVALID");
      }
    };
    await this.cloud.verifyPrivate();
    if (route === "POST /api/app/register") {
      const b = await jsonBody(request, MAX_APP_BODY_BYTES);
      onlyFields(b, ["mail", "password", "confirm", "nombre", "apellidos"]);
      const mail = normalizedMail(b.mail);
      if (b.password !== b.confirm) return reject(400, "PASSWORDS_DIFFER");
      const existing = await this.cloud.read<Profile>(profilePath(mail));
      if (existing) {
        if (
          existing.data.probeOnly ||
          !(await passwordMatches(b.password, existing.data.pwd || ""))
        )
          return reject(409, "USER_EXISTS");
        await this.initialize(mail);
        return respond({
          profile: clean(existing.data),
          token: await this.mint(existing.data),
        });
      }
      const p: Profile = {
        ...initialVersion(),
        mail,
        nombre: typeof b.nombre === "string" ? b.nombre : "",
        apellidos: typeof b.apellidos === "string" ? b.apellidos : "",
        fecha_nacimiento: null,
        peso: null,
        cinturon: "Blanco",
        perfil: "alumno",
        pwd: await passwordHash(b.password),
      };
      validate(() => validateProfile(p));
      // Profile first reserves identity. An interrupted registration can be resumed with
      // the same password; never mix another user's generated UUIDs into that folder.
      await this.cloud.write(profilePath(mail), p, null);
      await this.initialize(mail);
      return respond({ profile: clean(p), token: await this.mint(p) }, 201);
    }
    if (route === "POST /api/app/login") {
      const b = await jsonBody(request, MAX_APP_BODY_BYTES);
      onlyFields(b, ["mail", "password"]);
      const mail = normalizedMail(b.mail);
      const p = await this.cloud.read<Profile>(profilePath(mail));
      const matches = await passwordMatches(
        b.password,
        p?.data.pwd || "pbkdf2-sha256$600000$unknown$unknown",
      );
      if (!p || p.data.probeOnly || !matches)
        return reject(401, "LOGIN_FAILED");
      await this.initialize(mail);
      return respond({
        profile: clean(p.data),
        token: await this.mint(p.data),
      });
    }
    if (route === "POST /api/app/logout") {
      const s = await this.session(request);
      await this.store.delete(
        "app-session:" +
          (await fingerprint(request.headers.get("Authorization")!.slice(7))),
      );
      return respond({ status: "LOGGED_OUT", mail: s.session.mail });
    }
    if (route === "POST /api/app/password") {
      const actor = await this.session(request);
      const b = await jsonBody(request, MAX_APP_BODY_BYTES);
      onlyFields(b, ["mail", "password", "confirm", "sha"]);
      const mail = normalizedMail(b.mail || actor.session.mail);
      if (
        mail !== actor.session.mail &&
        actor.profile.data.perfil !== "entrenador"
      )
        return reject(403, "TRAINER_REQUIRED");
      if (b.password !== b.confirm) return reject(400, "PASSWORDS_DIFFER");
      const p = await this.profile(mail);
      if (mail !== actor.session.mail && p.data.perfil !== "alumno")
        return reject(400, "STUDENT_REQUIRED");
      if (b.sha !== p.sha) return reject(409, "VERSION_CONFLICT");
      // Requirement: change only pwd in profile (revision/updatedAt unchanged here).
      const pwd = await passwordHash(b.password);
      await this.cloud.write(profilePath(mail), { ...p.data, pwd }, p.sha);
      await this.revoke(mail);
      return respond({ status: "PASSWORD_CHANGED_SESSION_REVOKED" });
    }
    if (route === "GET /api/app/students") {
      await this.trainer(request);
      const users = [];
      for (const entry of (await this.cloud.list?.("PGT/users_data")) || []) {
        if (entry.type !== "dir") continue;
        let mail: string;
        try {
          mail = normalizedMail(entry.name);
        } catch {
          continue;
        }
        const p = await this.cloud.read<Profile>(profilePath(mail));
        if (p && !p.data.probeOnly)
          users.push({ profile: clean(p.data), sha: p.sha });
      }
      return respond({ users });
    }
    if (route === "POST /api/app/role") {
      const actor = await this.trainer(request);
      const b = await jsonBody(request, MAX_APP_BODY_BYTES);
      onlyFields(b, ["mail", "perfil", "sha"]);
      if (!["alumno", "entrenador"].includes(String(b.perfil)))
        return reject(400, "ROLE_INVALID");
      const mail = normalizedMail(b.mail);
      const p = await this.profile(mail);
      if (mail === actor.session.mail && b.perfil === "alumno")
        return reject(400, "SELF_DEMOTION_FORBIDDEN");
      if (b.sha !== p.sha) return reject(409, "VERSION_CONFLICT");
      await this.cloud.write(
        profilePath(mail),
        {
          ...p.data,
          perfil: b.perfil,
          revision: p.data.revision + 1,
          updatedAt: now(),
        },
        p.sha,
      );
      await this.revoke(mail);
      return respond({ status: "ROLE_CHANGED" });
    }
    if (route === "GET /api/app/catalog") {
      const actor = await this.session(request);
      const c = await this.cloud.read<Catalog>("PGT/master_data/plans.json");
      if (c && actor.profile.data.perfil === "alumno")
        return respond({
          ...c,
          data: {
            ...c.data,
            plans: c.data.plans
              .filter((p) => p.alumnos.includes(actor.session.mail))
              .map((p) => ({ ...p, alumnos: [actor.session.mail] })),
          },
        });
      return respond(
        c || {
          data: { ...initialVersion(), plans: [], deletedPlanIds: [] },
          sha: null,
        },
      );
    }
    if (
      route === "POST /api/app/competition" ||
      route === "POST /api/app/assignment" ||
      route === "POST /api/app/delete-competition"
    ) {
      await this.trainer(request);
      const b = await jsonBody(request, MAX_APP_BODY_BYTES);
      const old = await this.cloud.read<Catalog>("PGT/master_data/plans.json");
      if (b.sha !== (old?.sha ?? null)) return reject(409, "VERSION_CONFLICT");
      const c: Catalog = old
        ? structuredClone(old.data)
        : { ...initialVersion(), plans: [], deletedPlanIds: [] };
      if (route === "POST /api/app/competition") {
        onlyFields(b, ["competition", "sha"]);
        const input = b.competition as Competition;
        const invalidCompetition = validate(() => validateCompetition(input, 1));
        if (invalidCompetition) return invalidCompetition;
        if (!Array.isArray(input.alumnos) || input.alumnos.length > 100)
          return reject(400, "STUDENTS_INVALID");
        const p: Competition = {
          planId: crypto.randomUUID(),
          fecha_comienzo: input.fecha_comienzo,
          fecha_torneo: input.fecha_torneo,
          dias_de_entrenamiento: input.dias_de_entrenamiento,
          ejercicios_por_sesion: input.ejercicios_por_sesion,
          tiempo_por_tecnica_segundos: input.tiempo_por_tecnica_segundos,
          descanso_entre_ciclos_segundos: input.descanso_entre_ciclos_segundos,
          descanso_entre_tecnicas_segundos:
            input.descanso_entre_tecnicas_segundos,
          alumnos: [...new Set(input.alumnos.map(normalizedMail))],
        };
        for (const mail of p.alumnos) await this.profile(mail);
        c.plans.push(p);
      } else {
        onlyFields(
          b,
          route.endsWith("assignment")
            ? ["planId", "alumnos", "sha"]
            : ["planId", "sha"],
        );
        const p = c.plans.find((p) => p.planId === b.planId);
        if (!p) return reject(404, "COMPETITION_NOT_FOUND");
        if (route.endsWith("/assignment")) {
          if (!Array.isArray(b.alumnos)) return reject(400, "STUDENTS_INVALID");
          const students = b.alumnos.map(normalizedMail);
          for (const mail of students) await this.profile(mail);
          p.alumnos = [...new Set(students)];
        } else {
          c.plans = c.plans.filter((p) => p.planId !== b.planId);
          c.deletedPlanIds.push(p.planId);
        }
      }
      c.revision = (old?.data.revision || 0) + 1;
      c.updatedAt = now();
      await this.cloud.write("PGT/master_data/plans.json", c, old?.sha || null);
      await this.reconcile();
      return respond({ status: "COMPETITION_OPERATION_CONFIRMED" });
    }
    if(route === "GET /api/app/training-day") {
      await this.trainer(request);
      return respond(await readTrainingDay(this.cloud,url.searchParams.get("date")||"",madridDate(this.clock())));
    }
    const match = url.pathname.match(
      /^\/api\/app\/users\/([^/]+)\/(snapshot|view|profile|techniques|comments|plan)$/,
    );
    if (!match) return reject(404, "ENDPOINT_NOT_FOUND");
    const actor = await this.session(request);
    const mail = normalizedMail(decodeURIComponent(match[1]));
    const own = mail === actor.session.mail;
    if (!own && actor.profile.data.perfil !== "entrenador")
      return reject(403, "OTHER_USER_FORBIDDEN");
    const kind = match[2];
    if(request.method==="GET"&&kind==="view") {
      if(actor.profile.data.perfil!=="entrenador")return reject(403,"TRAINER_REQUIRED");
      const section=url.searchParams.get("section");
      if(!["techniques","plans","administration"].includes(section||""))return reject(400,"VIEW_INVALID");
      const q=url.searchParams.get("known")||"{}";
      let known:Record<string,string>;
      try{known=JSON.parse(q);if(q.length>16000||!known||Array.isArray(known)||typeof known!=="object"||Object.values(known).some(v=>typeof v!=="string"||!/^([0-9a-f]{40})$/.test(v)))throw Error();}catch{return reject(400,"SYNC_VERSIONS_INVALID");}
      const record=(key:string,r:CloudRecord<unknown>)=>known[key]===r.sha?{unchanged:true,sha:r.sha,planId:key.startsWith("plan:")?key.slice(5):undefined}:r;
      // Authorize every request against the current actor profile; caches never authorize access.
      const profile=own?actor.profile:await this.profile(mail);
      const result:Record<string,unknown>={profile:record("profile",{data:clean(profile.data),sha:profile.sha})};
      if(section==="administration")return respond(result);
      if(section==="techniques"){
        const metadata=await this.cloud.list?.(root(mail));
        const get=async(key:string,file:string)=>{
          const info=metadata?.find(f=>f.name===file&&f.type==="file");
          if(info?.sha&&known[key]===info.sha)return {unchanged:true,sha:info.sha};
          const value=await this.cloud.read(`${root(mail)}/${file}`);if(!value)return reject(409,"REGISTRATION_INCOMPLETE");return record(key,value);
        };
        const [techniques,comments]=await Promise.all([get("techniques","tecnics.json"),get("comments","trainer_comments.json")]);
        return respond({...result,techniques,comments});
      }
      const planId=url.searchParams.get("planId");
      if(planId&&!/^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(planId))return reject(400,"PLAN_ID_INVALID");
      const [catalog,listed]=await Promise.all([this.cloud.read<Catalog>("PGT/master_data/plans.json"),this.cloud.list?.(`${root(mail)}/training_plans`)]);
      const deleted=new Set(catalog?.data.deletedPlanIds||[]);
      const files=(listed||[]).filter(f=>f.type==="file"&&/^plan_[0-9a-f-]{36}\.json$/.test(f.name)&&!deleted.has(f.name.slice(5,-5)));
      result.planSummaries=files.map(file=>{const id=file.name.slice(5,-5);return {planId:id,fecha_torneo:catalog?.data.plans.find(p=>p.planId===id)?.fecha_torneo};});
      result.plans=[];
      if(!planId)return respond(result);
      if(!files.some(f=>f.name===`plan_${planId}.json`))return reject(404,"PLAN_NOT_FOUND");
      const loaded=await this.updatePlanTexts(mail,planId);
      const refreshed=(await this.cloud.list?.(`${root(mail)}/training_plans`))||[];
      const file=refreshed.find(f=>f.name===`plan_${planId}.json`);
      if(!file)return reject(404,"PLAN_NOT_FOUND");
      const key="plan:"+planId;
      if(file.sha&&known[key]===file.sha)result.plans=[{unchanged:true,sha:file.sha,planId}];
      else {
        const reused=loaded.get(file.name);
        const p=reused&&(!file.sha||reused.sha===file.sha)?reused:await this.cloud.read<TrainingPlan>(`${root(mail)}/training_plans/${file.name}`);
        if(!p||p.data.mail!==mail)return reject(409,"PLAN_IDENTITY_INVALID");
        result.plans=[record(key,p)];
      }
      return respond(result);
    }
    if (request.method === "GET" && kind === "snapshot") {
      let known: Record<string, string> = {};
      const q = url.searchParams.get("known");
      if (q) {
        if (q.length > 16000) return reject(400, "SYNC_VERSIONS_INVALID");
        try {
          known = JSON.parse(q);
          if (
            !known ||
            Array.isArray(known) ||
            typeof known !== "object" ||
            Object.values(known).some(
              (v) => typeof v !== "string" || !/^[0-9a-f]{40}$/.test(v),
            )
          )
            throw Error();
        } catch {
          return reject(400, "SYNC_VERSIONS_INVALID");
        }
      }
      await this.reconcile(mail);
      const planIssues:PlanIssue[]=[];
      await this.updatePlanTexts(mail,undefined,planIssues);
      const profile = own ? actor.profile : await this.profile(mail),
        catalog = await this.cloud.read<Catalog>("PGT/master_data/plans.json");
      const record = (key: string, r: CloudRecord<unknown>) =>
        known[key] === r.sha
          ? {
              unchanged: true,
              sha: r.sha,
              planId: key.startsWith("plan:") ? key.slice(5) : undefined,
            }
          : r;
      const metadata = (await this.cloud.list?.(root(mail))) || [];
      const get = async (key: string, file: string) => {
        const info = metadata.find((v) => v.name === file && v.type === "file");
        if (info?.sha && known[key] === info.sha)
          return { unchanged: true, sha: info.sha };
        const r = await this.cloud.read(`${root(mail)}/${file}`);
        if (!r) return reject(409, "REGISTRATION_INCOMPLETE");
        return record(key, r);
      };
      const techniques = await get("techniques", "tecnics.json"),
        comments = await get("comments", "trainer_comments.json"),
        index = await get("index", "plans_index.json");
      const plans: unknown[] = [],
        received = new Set<string>();
      for (const file of (await this.cloud.list?.(
        `${root(mail)}/training_plans`,
      )) || []) {
        if (
          file.type !== "file" ||
          !/^plan_[0-9a-f-]{36}\.json$/.test(file.name)
        )
          continue;
        const id = file.name.slice(5, -5);
        received.add(id);
        if (file.sha && known["plan:" + id] === file.sha) {
          plans.push({ unchanged: true, planId: id, sha: file.sha });
          continue;
        }
        const p = await this.cloud.read<TrainingPlan>(
          `${root(mail)}/training_plans/${file.name}`,
        );
        if (p) plans.push(record("plan:" + id, p));
        else received.delete(id);
      }
      if (own)
        for (const competition of catalog?.data.plans.filter((c) =>
          c.alumnos.includes(mail),
        ) || []) {
          const id = competition.planId;
          if (received.has(id)) continue;
          const t =
            "data" in techniques
              ? techniques.data
              : (
                  await this.cloud.read<Techniques>(
                    `${root(mail)}/tecnics.json`,
                  )
                )?.data;
          const notes =
            "data" in comments
              ? comments.data
              : (
                  await this.cloud.read<Comments>(
                    `${root(mail)}/trainer_comments.json`,
                  )
                )?.data;
          if (!t || !notes) return reject(409, "REGISTRATION_INCOMPLETE");
          if(!(t as Techniques).positions.some(position=>position.tecnicas.length)) {
            planIssues.push({planId:id,code:"NO_TRAINABLE_TECHNIQUES"});
            continue;
          }
          const plan = generatePlan(
            competition,
            mail,
            t as unknown as Techniques,
            notes as unknown as Comments,
            now(),
          );
          plan.appliedDescriptionUpdates = {
            ...(t as Techniques).descriptionUpdates,
          };
          plan.appliedCommentUpdates = {
            ...(notes as Comments).commentUpdates,
          };
          const path = `${root(mail)}/training_plans/plan_${id}.json`;
          const existing = await this.cloud.read<TrainingPlan>(path);
          try {
            plans.push(existing || {data:plan,sha:await this.cloud.write(path,plan,null)});
          } catch(error) {
            if(error instanceof ApiError && error.status===413 && error.message==="JSON_TOO_LARGE" && error.size?.file===`plan_${id}.json`)
              planIssues.push({planId:id,code:"PLAN_TOO_LARGE",size:error.size});
            else throw error;
          }
        }
      return respond({
        profile: record("profile", {
          data: clean(profile.data),
          sha: profile.sha,
        }),
        techniques,
        comments,
        index,
        plans,
        planIssues,
        deletedPlanIds: [...new Set([...(catalog?.data.deletedPlanIds || []), ...((await this.cloud.read<Index>(`${root(mail)}/plans_index.json`))?.data.deletedPlanIds || [])])],
      });
    }
    if (request.method === "PUT" && kind === "profile") {
      if (!own) return reject(403, "OWN_PROFILE_ONLY");
      const b = await jsonBody(request, MAX_APP_BODY_BYTES);
      onlyFields(b, ["data", "sha"]);
      const current = await this.profile(mail);
      if (b.sha !== current.sha) return reject(409, "VERSION_CONFLICT");
      const p = b.data as Profile;
      const next: Profile = {
        ...current.data,
        nombre: p.nombre,
        apellidos: p.apellidos,
        peso: p.peso,
        fecha_nacimiento: p.fecha_nacimiento,
        cinturon: p.cinturon,
        revision: current.data.revision + 1,
        updatedAt: now(),
      };
      validate(() => validateProfile(next));
      if (unchanged(clean(next), clean(current.data)))
        return respond({
          data: clean(current.data),
          sha: current.sha,
          status: "UNCHANGED_NO_COMMIT",
        });
      const sha = await this.cloud.write(profilePath(mail), next, current.sha);
      return respond({ data: clean(next), sha });
    }
    if (request.method === "PUT" && kind === "techniques") {
      if (!own) return reject(403, "OWN_TECHNIQUES_ONLY");
      const b = await jsonBody(request, MAX_APP_BODY_BYTES);
      onlyFields(b, ["data", "sha"]);
      const path = `${root(mail)}/tecnics.json`;
      const old = await this.checkSha(path, b.sha);
      const next = b.data as Techniques;
      validate(() => validateTechniques(next));
      // Tombstones are server-owned and survive partial plan writes and subsequent retries.
      const removed = deletedUUIDs(old!.data as unknown as Techniques, next);
      next.deletionRevision = ((old!.data as unknown as Techniques).deletionRevision || 0) + Number(removed.length > 0);
      if (!next.deletionRevision) delete next.deletionRevision;
      next.deletionCatalog = (old!.data as unknown as Techniques).deletionCatalog || (removed.length ? catalogOf(old!.data as unknown as Techniques) : undefined);
      if (!next.deletionCatalog) delete next.deletionCatalog;
      next.deletedIds = [...new Set([...((old!.data as unknown as Techniques).deletedIds || []), ...removed])];
      if (!next.deletedIds.length) delete next.deletedIds;

      const idsChanged = descriptionChanges(
        old!.data as unknown as Techniques,
        next,
      );
      const versions = updateTextVersions(
        (old!.data as unknown as Techniques).descriptionUpdates,
        idsChanged,
        opaqueToken(),
      );
      const retainedIds = new Set(
        next.positions.flatMap((p) => p.tecnicas.map((t) => t.id)),
      );
      for (const id of Object.keys(versions))
        if (!retainedIds.has(id)) delete versions[id];
      if (Object.keys(versions).length) next.descriptionUpdates = versions;
      else delete next.descriptionUpdates;
      next.revision = Number(old?.data.revision || 0) + 1;
      next.updatedAt = now();
      const same = old && unchanged(next, old.data);
      const sha = same
        ? old.sha
        : await this.cloud.write(path, next, old?.sha || null);
      const notes = await this.cloud.read<Comments>(
        `${root(mail)}/trainer_comments.json`,
      );
      if (notes) {
        const ids = new Set(
          next.positions.flatMap((p) => p.tecnicas.map((t) => t.id)),
        );
        const comments = notes.data.comments.filter((c) =>
          ids.has(c.techniqueId),
        );
        if (comments.length !== notes.data.comments.length)
          await this.cloud.write(
            `${root(mail)}/trainer_comments.json`,
            {
              ...notes.data,
              comments,
              revision: notes.data.revision + 1,
              updatedAt: now(),
            },
            notes.sha,
          );
      }
      const planIssues:PlanIssue[]=[];
      await this.updatePlanTexts(mail,undefined,planIssues);
      return respond({
        planIssues,
        data: same ? old.data : next,
        sha,
        status: same ? "UNCHANGED_NO_COMMIT" : "WRITE_CONFIRMED",
      });
    }
    if (request.method === "PUT" && kind === "comments") {
      if (actor.profile.data.perfil !== "entrenador")
        return reject(403, "TRAINER_REQUIRED");
      const b = await jsonBody(request, MAX_APP_BODY_BYTES);
      onlyFields(b, ["data", "sha"]);
      const path = `${root(mail)}/trainer_comments.json`;
      const old = await this.checkSha(path, b.sha);
      const notes = b.data as Comments;
      validate(() => validateVersion(notes));
      if (
        !Array.isArray(notes.comments) ||
        notes.comments.length > 20000 ||
        new Set(notes.comments.map((c) => c.techniqueId)).size !==
          notes.comments.length
      )
        return reject(400, "COMMENTS_INVALID");
      const t = await this.cloud.read<Techniques>(`${root(mail)}/tecnics.json`);
      const ids = new Set(
        t?.data.positions.flatMap((p) => p.tecnicas.map((t) => t.id)),
      );
      for (const c of notes.comments)
        if (
          !ids.has(c.techniqueId) ||
          typeof c.comment !== "string" ||
          c.comment.length > MAX_TEXT_LENGTH
        )
          return reject(400, "COMMENT_INVALID");
      // Authorship is assigned from the authenticated profile, never from payloads.
      const previousComments = new Map((old?.data as unknown as Comments)?.comments.map(c => [c.techniqueId,c]) || []);
      const trainerName = [actor.profile.data.nombre,actor.profile.data.apellidos].filter(Boolean).join(" ").trim();
      notes.comments = notes.comments.map(c => {
        const previous = previousComments.get(c.techniqueId);
        const author = c.comment !== previous?.comment && c.comment.trim() ? trainerName : previous?.trainerName;
        return {techniqueId:c.techniqueId,comment:c.comment,...(author ? {trainerName:author} : {})};
      });
      const versions = updateTextVersions(
        (old?.data as unknown as Comments)?.commentUpdates,
        commentChanges(
          (old?.data as unknown as Comments) || {
            ...initialVersion(),
            comments: [],
          },
          notes,
        ),
        opaqueToken(),
      );
      for (const id of Object.keys(versions))
        if (!ids.has(id)) delete versions[id];
      if (Object.keys(versions).length) notes.commentUpdates = versions;
      else delete notes.commentUpdates;
      notes.revision = Number(old?.data.revision || 0) + 1;
      notes.updatedAt = now();
      const same = old && unchanged(notes, old.data);
      const sha = same
        ? old.sha
        : await this.cloud.write(path, notes, old?.sha || null);
      const planIssues:PlanIssue[]=[];
      await this.updatePlanTexts(mail,undefined,planIssues);
      return respond({
        planIssues,
        data: same ? old.data : notes,
        sha,
        status: same ? "UNCHANGED_NO_COMMIT" : "WRITE_CONFIRMED",
      });
    }
    if (request.method === "PUT" && kind === "plan") {
      return reject(403, "PLAN_READ_ONLY");
    }
    return reject(404, "ENDPOINT_NOT_FOUND");
  }
}
