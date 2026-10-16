import { test } from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import Dexie from "dexie";
import {
  db,
  repository,
  type LocalEntry,
} from "../src/infrastructure/local.ts";
import { initialVersion } from "../src/domain/models.ts";
// Node lacks CustomEvent, used only by Dexie's database close event.
if (!globalThis.CustomEvent)
  globalThis.CustomEvent = class<T> extends Event {
    detail: T;
    constructor(type: string, init?: CustomEventInit<T>) {
      super(type);
      this.detail = init?.detail as T;
    }
  } as unknown as typeof CustomEvent;
test("IndexedDB: guardas de propietario y sustitución atómica con rollback", async () => {
  await db.delete();
  await db.open();
  const make = (mail: string): LocalEntry => ({
    key: "techniques",
    mail,
    endpoint: "/unused",
    data: { ...initialVersion(), positions: [] },
    base: { ...initialVersion(), positions: [] },
    sha: null,
    dirty: true,
    conflicts: [],
  });
  await db.meta.put({ key: "owner", value: "a@example.com" });
  await repository.save(make("a@example.com"), "a@example.com");
  await assert.rejects(repository.save(make("a@example.com"), "b@example.com"));
  await assert.rejects(repository.entries("b@example.com"));
  await assert.rejects(
    db.transaction("rw", db.entries, db.meta, async () => {
      await db.entries.clear();
      await db.entries.put(make("b@example.com"));
      await db.meta.put({ key: "owner", value: "b@example.com" });
      throw Error("synthetic interrupted restore");
    }),
  );
  assert.equal(await repository.owner(), "a@example.com");
  assert.equal(
    (await repository.entries("a@example.com"))[0].mail,
    "a@example.com",
  );
  await db.transaction("rw", db.entries, db.meta, async () => {
    await db.entries.clear();
    await db.entries.put(make("b@example.com"));
    await db.meta.put({ key: "owner", value: "b@example.com" });
  });
  await assert.rejects(repository.entries("a@example.com"));
  assert.equal(
    (await repository.entries("b@example.com"))[0].mail,
    "b@example.com",
  );
  await db.delete();
});

test("IndexedDB v2 → v3 preserves offline pending edits, ownership and trainer views",async()=>{
 await db.delete();
 const legacy=new Dexie("pgt-active-user-v1");legacy.version(2).stores({entries:"key,mail,dirty",meta:"key",trainerViews:"key,owner,mail"});await legacy.open();
 const entry={key:"techniques",mail:"offline@example.com",dirty:true,data:{positions:[{id:"retained",descripcion:"sin sincronizar"}]},base:{positions:[]},sha:null,conflicts:["pendiente"]};
 await legacy.table("entries").put(entry);await legacy.table("meta").put({key:"owner",value:entry.mail});await legacy.table("trainerViews").put({key:"cached",owner:"trainer@example.com",mail:entry.mail,data:{retained:true}});legacy.close();
 await db.open();assert.deepEqual(await db.entries.get("techniques"),entry);assert.equal((await db.meta.get("owner"))?.value,entry.mail);assert.equal(await db.trainerViews.count(),1);assert.equal(await db.trainerDays.count(),0);await db.delete();
});
