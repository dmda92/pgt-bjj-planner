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
  private async updatePlanTexts(mail: string) {
    const planFiles = (
      (await this.cloud.list?.(`${root(mail)}/training_plans`)) || []
    ).filter(
      (f) => f.type === "file" && /^plan_[0-9a-f-]{36}\.json$/.test(f.name),
    );
    if (!planFiles.length) return;
    const techniques = await this.cloud.read<Techniques>(
      `${root(mail)}/tecnics.json`,
    );
    const comments = await this.cloud.read<Comments>(
      `${root(mail)}/trainer_comments.json`,
    );
    if (
      !techniques ||
      !comments ||
      (!techniques.data.descriptionUpdates && !comments.data.commentUpdates && !techniques.data.deletedIds?.length)
    )
      return;
    for (const file of planFiles) {
      const path = `${root(mail)}/training_plans/${file.name}`;
      for (let attempt = 0; attempt < 3; attempt++) {
        const current = await this.cloud.read<TrainingPlan>(path);
        if (
          !current ||
          current.data.mail !== mail ||
          current.data.fecha_torneo <= madridDate(this.clock())
        )
          break;
        const latestTechniques = await this.cloud.read<Techniques>(
          `${root(mail)}/tecnics.json`,
        );
        const latestComments = await this.cloud.read<Comments>(
          `${root(mail)}/trainer_comments.json`,
        );
        if (!latestTechniques || !latestComments) break;
        const next = updateFuturePlanText(
          updateFutureDeletions(current.data, latestTechniques.data, latestComments.data, madridDate(this.clock())),
          latestTechniques.data,
          latestComments.data,
          madridDate(this.clock()),
        );
        if (next === current.data) break;
        try {
          await this.cloud.write(
            path,
            { ...next, revision: current.data.revision + 1, updatedAt: now() },
            current.sha,
          );
          break;
        } catch (error) {
          if (
            !(error instanceof ApiError) ||
            ![409, 422].includes(error.status) ||
            attempt === 2
          )
            throw error;
        }
      }
    }
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
      if (JSON.stringify(current?.data.planIds || []) !== JSON.stringify(ids))
        await this.cloud.write(
          path,
          {
            ...initialVersion(),
            revision: (current?.data.revision || 0) + 1,
            planIds: ids,
          },
          current?.sha || null,
        );
      for (const id of catalog.data.deletedPlanIds) {
        const planPath = `${root(mail)}/training_plans/plan_${id}.json`;
        const old = await this.cloud.read(planPath);
        if (old) await this.cloud.remove(planPath, old.sha);
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
        validate(() => validateCompetition(input));
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
    const match = url.pathname.match(
      /^\/api\/app\/users\/([^/]+)\/(snapshot|profile|techniques|comments|plan)$/,
    );
    if (!match) return reject(404, "ENDPOINT_NOT_FOUND");
    const actor = await this.session(request);
    const mail = normalizedMail(decodeURIComponent(match[1]));
    const own = mail === actor.session.mail;
    if (!own && actor.profile.data.perfil !== "entrenador")
      return reject(403, "OTHER_USER_FORBIDDEN");
    const kind = match[2];
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
      await this.updatePlanTexts(mail);
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
          plans.push(
            existing || {
              data: plan,
              sha: await this.cloud.write(path, plan, null),
            },
          );
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
        deletedPlanIds: catalog?.data.deletedPlanIds || [],
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
      await this.updatePlanTexts(mail);
      return respond({
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
      await this.updatePlanTexts(mail);
      return respond({
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
