import Dexie, { type Table } from "dexie";
import type { Document, RemoteRecord } from "../domain/models.ts";
export interface LocalEntry {
  key: string;
  mail: string;
  endpoint: string;
  data: Document;
  base: Document;
  sha: string | null;
  dirty: boolean;
  conflicts: string[];
  remote?: RemoteRecord;
}
export interface Meta {
  key: string;
  value: string;
}
export class LocalDb extends Dexie {
  entries!: Table<LocalEntry, string>;
  meta!: Table<Meta, string>;
  trainerViews!: Table<import("../application/trainer-cache.ts").TrainerCacheEntry,string>;
  trainerDays!: Table<{key:string;owner:string;data:import("../domain/trainer-reports.ts").TrainingDay},string>;
  commentNotices!: Table<CommentNotice, [string,string]>;
  constructor() {
    super("pgt-active-user-v1");
    this.version(1).stores({ entries: "key,mail,dirty", meta: "key" });
    this.version(2).stores({entries:"key,mail,dirty",meta:"key",trainerViews:"key,owner,mail"});
    this.version(3).stores({entries:"key,mail,dirty",meta:"key",trainerViews:"key,owner,mail",trainerDays:"key,owner"});
    this.version(4).stores({entries:"key,mail,dirty",meta:"key",trainerViews:"key,owner,mail",trainerDays:"key,owner",commentNotices:"[owner+techniqueId],owner"});
  }
}
export interface CommentNotice {owner:string;techniqueId:string;version:string;unread:boolean;receivedAt:string}
export const db = new LocalDb();
export interface LocalRepository {
  owner(): Promise<string | undefined>;
  entries(mail: string): Promise<LocalEntry[]>;
  save(entry: LocalEntry, mail: string): Promise<void>;
}
export const repository: LocalRepository = {
  owner: async () => (await db.meta.get("owner"))?.value,
  entries: async (mail) =>
    db.transaction("r", db.entries, db.meta, async () => {
      if ((await db.meta.get("owner"))?.value !== mail)
        throw Error("La base local pertenece a otra sesión");
      return db.entries.toArray();
    }),
  save: async (entry, mail) =>
    db.transaction("rw", db.entries, db.meta, async () => {
      if ((await db.meta.get("owner"))?.value !== mail || entry.mail !== mail)
        throw Error("Sesión local incompatible");
      await db.entries.put(entry);
    }),
};
