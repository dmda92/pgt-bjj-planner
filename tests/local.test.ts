import { test } from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
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
