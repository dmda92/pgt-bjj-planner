import type {
  Profile,
  Document,
  RemoteRecord,
  TrainingPlan,
} from "../domain/models.ts";
import {
  validateTechniques,
  validateVersion,
  validateProfile,
  validatePlan,
} from "../domain/models.ts";
import { db, repository, type LocalEntry } from "../infrastructure/local.ts";
import { merge, resolveRemote } from "../domain/merge.ts";
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
  identity: Identity | null = null;
  locked = false;
  status = "Sin sesión";
  private running: Promise<void> | null = null;
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
  private requireIdentity() {
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
    const response = await fetch(API + path, {
      method,
      headers: {
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    const value = (await response.json()) as any;
    if (!response.ok) {
      if (response.status === 401 && credential === undefined) {
        this.locked = true;
        this.status = "La sesión remota fue revocada. Vuelve a entrar.";
        this.onChange();
      }
      throw new ApiFailure(response.status, value.error || "Error de API");
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
      await db.transaction("rw", db.entries, db.meta, async () => {
        await db.entries.clear();
        await db.entries.bulkPut(entries);
        await db.meta.put({ key: "owner", value: identity.mail });
      });
    this.identity = identity;
    this.locked = false;
    localStorage.setItem("pgt-session", JSON.stringify(identity));
    this.channel.postMessage("session-changed");
    this.status =
      owner && owner !== identity.mail
        ? "Usuario restaurado"
        : "Sesión iniciada";
    this.onChange();
    if (reopening) await this.sync();
  }
  private validate(s: Snapshot) {
    if (
      !s.profile ||
      !s.techniques ||
      !s.comments ||
      !s.index ||
      !Array.isArray(s.plans)
    )
      throw Error("Restauración incompleta");
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
  private snapshotEntries(s: Snapshot, mail: string): LocalEntry[] {
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
  private async snapshot(mail: string): Promise<Snapshot> {
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
  async load() {
    if (!this.identity || this.locked) return [];
    return repository.entries(this.identity.mail);
  }
  async edit(key: string, data: Document) {
    const identity = this.requireIdentity();
    const old = await db.entries.get(key);
    if (!old || old.mail !== identity.mail) throw Error("Datos de otra sesión");
    this.requireIdentity();
    if (JSON.stringify(old.data) === JSON.stringify(data)) return;
    await repository.save(
      { ...old, data: structuredClone(data), dirty: true, conflicts: [] },
      identity.mail,
    );
    this.status = "Cambios guardados en este dispositivo";
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
      for (const entry of await repository.entries(identity.mail)) {
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
        const saved = await this.request<RemoteRecord>(entry.endpoint, "PUT", {
          data: merged.value,
          sha: current.sha,
        });
        this.requireIdentity();
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
      }
      snapshot = await this.snapshot(identity.mail);
      this.validate(snapshot);
      for (const fresh of this.snapshotEntries(snapshot, identity.mail)) {
        this.requireIdentity();
        await db.transaction("rw", db.entries, db.meta, async () => {
          const local = await db.entries.get(fresh.key);
          if (!local?.dirty) await repository.save(fresh, identity.mail);
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
      this.status = remaining.length
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
    this.status = "Copia importada como cambios pendientes";
    this.onChange();
  }
  async resolve(key: string, choice: "local" | "remote") {
    const identity = this.requireIdentity();
    const entry = await db.entries.get(key);
    if (!entry) throw Error("No hay conflicto");
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
    await repository.save(
      {
        ...entry,
        data,
        base: r.data,
        sha: r.sha,
        dirty: JSON.stringify(data) !== JSON.stringify(r.data),
        conflicts: [],
        remote: undefined,
      },
      identity.mail,
    );
    this.onChange();
  }
  async logout(revoked = false) {
    const identity = this.identity;
    if (!identity) throw Error("No hay sesión");
    // Lock immediately, retain local business data and queue. Remote token revoked best-effort.
    this.locked = true;
    this.onChange();
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
export const client = new Client();
