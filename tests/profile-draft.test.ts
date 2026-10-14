import { test } from "node:test";
import assert from "node:assert/strict";
import {
  refreshProfileDraft,
  type ProfileDraft,
} from "../src/application/profile-draft.ts";
const initial: ProfileDraft = {
  nombre: "Nombre",
  apellidos: "Apellido",
  fecha: "1992-08-24",
  peso: "72",
  cinturon: "Blanco",
};
const remote: ProfileDraft = {
  nombre: "Nuevo",
  apellidos: "Nuevos",
  fecha: "1990-01-01",
  peso: "75",
  cinturon: "Negro",
};
test("PRO 01 refreshes all untouched profile fields from sync without mutating inputs", () => {
  assert.deepEqual(refreshProfileDraft(initial, initial, remote), remote);
  assert.equal(initial.nombre, "Nombre");
});
test("Remote profile refresh preserves unsaved edits while updating untouched fields", () => {
  assert.deepEqual(
    refreshProfileDraft(
      { ...initial, nombre: "Borrador", peso: "" },
      initial,
      remote,
    ),
    { ...remote, nombre: "Borrador", peso: "" },
  );
});
test("Saved profile draft becomes baseline including equivalent weight formatting", () => {
  const saved = refreshProfileDraft(
    { ...remote, peso: "75.0" },
    initial,
    remote,
  );
  assert.deepEqual(saved, remote);
  assert.equal(
    refreshProfileDraft(saved, remote, { ...remote, peso: "76" }).peso,
    "76",
  );
});
