import { madridDate } from "../src/domain/plan-text-updates.ts";
import { template } from "../tests/template-fixture.ts";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { chromium } from "playwright";
import { AppApi } from "../worker/application.ts";
import { ApiError } from "../worker/security.ts";
// Isolated local fixture. Does not use Cloudflare or GitHub credentials and cannot deploy.
const files = new Map([
    [
      "PGT/master_data/tecnics_base.json",
      {
        data: structuredClone(template),
        sha: "1".repeat(40),
      },
    ],
  ]),
  sessions = new Map();
let revision = 1,
  failSnapshots = false;
const store = {
  get: async (k) => sessions.get(k),
  put: async (k, v) => sessions.set(k, v),
  delete: async (k) => sessions.delete(k),
  list: async ({ prefix }) =>
    new Map([...sessions].filter(([k]) => k.startsWith(prefix))),
};
const cloud = {
  verifyPrivate: async () => {},
  read: async (p) => files.get(p) || null,
  write: async (p, data, sha) => {
    if ((files.get(p)?.sha ?? null) !== sha)
      throw new ApiError(409, "VERSION_CONFLICT");
    const next = (++revision).toString(16).padStart(40, "0");
    files.set(p, { data: structuredClone(data), sha: next });
    return next;
  },
  remove: async (p, sha) => {
    assert.equal(files.get(p)?.sha, sha);
    files.delete(p);
  },
  list: async (dir) =>
    [
      ...new Set(
        [...files.keys()]
          .filter((p) => p.startsWith(dir + "/"))
          .map((p) => p.slice(dir.length + 1).split("/")[0]),
      ),
    ].map((name) => ({ name, type: name.endsWith(".json") ? "file" : "dir" })),
};
const api = new AppApi(store, cloud);
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname.startsWith("/api/")) {
      if (failSnapshots && url.pathname.endsWith("/snapshot")) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "SYNTHETIC_UNAVAILABLE" }));
        return;
      }
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const request = new Request(url, {
        method: req.method,
        headers: req.headers,
        body: ["GET", "HEAD"].includes(req.method)
          ? undefined
          : Buffer.concat(chunks),
      });
      let response;
      try {
        response = await api.handle(request, url);
      } catch (e) {
        if (!(e instanceof ApiError)) throw e;
        response = Response.json({ error: e.message }, { status: e.status });
      }
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    const path = resolve("dist", "." + url.pathname);
    if (!path.startsWith(resolve("dist") + "/") && path !== resolve("dist")) {
      res.writeHead(403);
      res.end();
      return;
    }
    const body = await readFile(
      url.pathname === "/" ? "dist/index.html" : path,
    );
    const mime =
      {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".webmanifest": "application/manifest+json",
        ".jpg": "image/jpeg",
        ".png": "image/png",
        ".svg": "image/svg+xml",
        ".ttf": "font/ttf",
      }[extname(path)] || "text/html";
    res.writeHead(200, { "Content-Type": mime });
    res.end(body);
  } catch (e) {
    res.writeHead(500);
    res.end("Local fixture error");
    console.error(e.name);
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = "http://127.0.0.1:" + server.address().port;
await mkdir(".browser-artifacts", { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PGT_TEST_CHROMIUM_PATH
    ? {
        executablePath: process.env.PGT_TEST_CHROMIUM_PATH,
        args: JSON.parse(process.env.PGT_TEST_CHROMIUM_ARGS || "[]"),
      }
    : {}),
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  acceptDownloads: true,
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => d.accept());
async function visible(locator) {
  await locator.waitFor({ state: "visible", timeout: 15000 });
}
async function login(mail) {
  await page.getByLabel("Correo", { exact: true }).fill(mail);
  await page
    .getByLabel("Contraseña", { exact: true })
    .fill("synthetic-browser-password");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
}
async function register(mail, name) {
  await page.getByRole("button", { name: "Registrarme", exact: true }).click();
  await page.getByLabel("Correo", { exact: true }).fill(mail);
  await page.getByLabel("Nombre", { exact: true }).fill(name);
  await page.getByLabel("Apellidos", { exact: true }).fill("Fixture");
  await page
    .getByLabel("Contraseña", { exact: true })
    .fill("synthetic-browser-password");
  await page
    .getByLabel("Repetir contraseña", { exact: true })
    .fill("synthetic-browser-password");
  await page
    .getByRole("button", { name: "Crear cuenta de alumno", exact: true })
    .click();
  await visible(page.getByRole("heading", { name: "Tu repertorio" }));
}
async function sync(p = page) {
  await p.getByRole("button", { name: "Sincronizar", exact: true }).click();
  await p
    .getByRole("status")
    .filter({ hasText: /^Sincronizado$/ })
    .waitFor({ timeout: 15000 });
}
try {
  await page.goto(origin);
  await register("browser-trainer@example.com", "Trainer");
  assert.equal(await page.locator(".position").count(), 17);
  await page.screenshot({
    path: ".browser-artifacts/desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Salir", exact: true }).click();
  await visible(page.getByRole("button", { name: "Entrar", exact: true }));
  files.get("PGT/users_data/browser-trainer@example.com/user_data.json").data.perfil = "entrenador";
  assert.equal(await page.getByText("Configuración inicial del propietario").count(), 0);
  await register("browser-student@example.com", "Student");
  await page
    .getByLabel("Descripción de técnica o enlace de vídeo")
    .first()
    .fill("Mi técnica favorita");
  await sync();
  assert.equal(
    files.get("PGT/users_data/browser-student@example.com/tecnics.json").data
      .positions[0].tecnicas[0].descripcion_del_alumno,
    "Mi técnica favorita",
  );
  const device = await browser.newContext({
      viewport: { width: 1024, height: 768 },
    }),
    other = await device.newPage();
  other.on("dialog", (d) => d.accept());
  await other.goto(origin);
  await other
    .getByLabel("Correo", { exact: true })
    .fill("browser-student@example.com");
  await other
    .getByLabel("Contraseña", { exact: true })
    .fill("synthetic-browser-password");
  await other.getByRole("button", { name: "Entrar", exact: true }).click();
  await visible(other.getByRole("heading", { name: "Tu repertorio" }));
  await context.setOffline(true);
  await page
    .getByLabel("Descripción de técnica o enlace de vídeo")
    .first()
    .fill("Concurrent local");
  await other
    .getByLabel("Descripción de técnica o enlace de vídeo")
    .nth(1)
    .fill("Concurrent remote");
  await sync(other);
  await context.setOffline(false);
  await sync();
  assert.equal(
    await page
      .getByLabel("Descripción de técnica o enlace de vídeo")
      .nth(1)
      .inputValue(),
    "Concurrent remote",
  );
  assert.equal(
    await page
      .getByLabel("Descripción de técnica o enlace de vídeo")
      .first()
      .inputValue(),
    "Concurrent local",
  );
  await sync(other);
  await context.setOffline(true);
  await page
    .getByLabel("Descripción de técnica o enlace de vídeo")
    .first()
    .fill("Conflicto local");
  await other
    .getByLabel("Descripción de técnica o enlace de vídeo")
    .first()
    .fill("Conflicto remoto");
  await sync(other);
  await context.setOffline(false);
  await visible(page.getByRole("heading", { name: "Conflicto en techniques" }));
  await page.getByRole("button", { name: "Conservar mi versión" }).click();
  await sync();
  assert.equal(
    files.get("PGT/users_data/browser-student@example.com/tecnics.json").data
      .positions[0].tecnicas[0].descripcion_del_alumno,
    "Conflicto local",
  );
  await device.close();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await visible(page.getByRole("heading", { name: "Tu repertorio" }));
  await context.setOffline(true);
  await page
    .getByLabel("Descripción de técnica o enlace de vídeo")
    .first()
    .fill("Edición offline");
  await page.waitForFunction(
    () =>
      new Promise((resolve) => {
        const request = indexedDB.open("pgt-active-user-v1");
        request.onsuccess = () => {
          const database = request.result;
          const read = database
            .transaction("entries")
            .objectStore("entries")
            .get("techniques");
          read.onsuccess = () => {
            const value =
              read.result?.data.positions[0].tecnicas[0].descripcion_del_alumno;
            database.close();
            resolve(value === "Edición offline");
          };
        };
      }),
  );
  await page.reload();
  await visible(page.getByRole("heading", { name: "Tu repertorio" }));
  assert.equal(
    await page
      .getByLabel("Descripción de técnica o enlace de vídeo")
      .first()
      .inputValue(),
    "Edición offline",
  );
  await page.getByRole("button", { name: "Salir", exact: true }).click();
  failSnapshots = true;
  await context.setOffline(false);
  await login("browser-trainer@example.com");
  await visible(page.getByRole("alert"));
  assert.match(await page.getByRole("alert").innerText(), /pendientes/);
  assert.equal(await page.locator(".position").count(), 0);
  failSnapshots = false;
  await login("browser-student@example.com");
  await visible(page.getByRole("heading", { name: "Tu repertorio" }));
  await sync();
  await page.getByRole("button", { name: "Salir", exact: true }).click();
  await visible(page.getByRole("button", { name: "Entrar", exact: true }));
  failSnapshots = true;
  await login("browser-trainer@example.com");
  await visible(page.getByRole("alert"));
  assert.match(
    await page.getByRole("alert").innerText(),
    /SYNTHETIC_UNAVAILABLE/,
  );
  assert.equal(await page.locator(".position").count(), 0);
  assert.equal(
    await page.evaluate(() => localStorage.getItem("pgt-session")),
    null,
  );
  failSnapshots = false;
  await login("browser-trainer@example.com");
  await visible(page.getByRole("heading", { name: "Tu repertorio" }));
  assert.equal(
    await page
      .getByLabel("Descripción de técnica o enlace de vídeo")
      .first()
      .inputValue(),
    "",
  );
  await page.getByRole("button", { name: "Entrenador", exact: true }).click();
  await visible(page.getByRole("heading", { name: "Tu equipo", exact: true }));
  await visible(page.getByRole("button", { name: /Student Fixture/ }));
  await page.evaluate(() => document.fonts.ready);
  assert.equal(
    await page
      .getByRole("navigation", { name: "Secciones" })
      .getByRole("button", { name: "Entrenador", exact: true })
      .getAttribute("aria-current"),
    "page",
  );
  assert.match(
    await page.locator(".dashboard-overview").innerText(),
    /Alumnos registrados/,
  );
  assert.deepEqual(
    await page.locator(".dashboard-overview dd").allTextContents(),
    ["1", "0", "0"],
  );
  await page.screenshot({
    path: ".browser-artifacts/trainer-desktop-empty.png",
    fullPage: true,
  });
  await page
    .getByLabel("Buscar alumnos", { exact: true })
    .fill("Sin coincidencia fixture");
  await visible(
    page.getByText("No hay coincidencias. Prueba con otro nombre o correo."),
  );
  assert.equal(await page.locator(".student-card").count(), 0);
  await page.getByLabel("Buscar alumnos", { exact: true }).fill("student");
  await page.getByRole("button", { name: /Student Fixture/ }).click();
  await visible(
    page.getByRole("heading", { name: "Student Fixture", exact: true }),
  );
  assert.equal(await page.locator(".student-selected").count(), 1);
  assert.equal(
    await page
      .getByRole("progressbar", { name: "Técnicas con descripción" })
      .getAttribute("value"),
    "2",
  );
  assert.equal(
    await page
      .getByRole("progressbar", { name: "Técnicas con descripción" })
      .getAttribute("max"),
    "36",
  );
  await page.locator(".student-detail details summary").first().click();
  await page
    .getByLabel("Comentario", { exact: true })
    .first()
    .fill("Comentario del entrenador fixture");
  await page
    .getByRole("button", { name: "Guardar comentario remoto" })
    .first()
    .click();
  await page.getByRole("button", { name: "Actualizar", exact: true }).click();
  await page.waitForFunction(() =>
    document
      .querySelector(".student-detail")
      ?.textContent.includes("Student Fixture"),
  );
  assert.equal(
    files.get(
      "PGT/users_data/browser-student@example.com/trainer_comments.json",
    ).data.comments[0].comment,
    "Comentario del entrenador fixture",
  );
  assert.equal(
    files.get("PGT/users_data/browser-student@example.com/tecnics.json").data
      .positions[0].tecnicas[0].descripcion_del_alumno,
    "Edición offline",
  );
  for (const width of [360, 390, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      `Dashboard overflows at ${width}px`,
    );
    await page.evaluate(() => scrollTo(0, 0));
    await page.waitForTimeout(180);
    await page.screenshot({
      path: `.browser-artifacts/trainer-${width}.png`,
      fullPage: false,
    });
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await page
      .getByRole("button", { name: "Sincronizar", exact: true })
      .evaluate((el) => getComputedStyle(el).transitionDuration),
    "0s",
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByLabel("Buscar alumnos", { exact: true }).fill("");

  await page
    .getByRole("button", { name: "Competiciones", exact: true })
    .click();
  await visible(page.getByRole("heading", { name: "Crear competición" }));
  await page.getByLabel("Fecha inicial", { exact: true }).fill("2026-10-13");
  await page.getByLabel("Fecha del torneo", { exact: true }).fill("2026-10-23");
  assert.equal(await page.locator("input[name=student]").count(), 2);
  await page
    .locator('input[name=student][value="browser-student@example.com"]')
    .check();
  await page
    .locator('input[name=student][value="browser-trainer@example.com"]')
    .check();
  await page
    .getByRole("button", { name: "Crear competición con configuración fija" })
    .click();
  await visible(page.getByRole("heading", { name: "Torneo · 2026-10-23" }));
  assert.deepEqual(
    await page.locator(".dashboard-overview dd").allTextContents(),
    ["1", "1", "2"],
  );
  await page.screenshot({
    path: ".browser-artifacts/trainer-competition.png",
    fullPage: true,
  });
  await sync(); // trainer receives their own snapshot just like any competitor.
  await page.getByRole("button", { name: /Mis planes/ }).click();
  await visible(page.getByRole("heading", { name: "Torneo · 2026-10-23" }));
  assert.match(await page.locator(".timer").innerText(), /32:10/);
  await page.getByRole("button", { name: "Entrenador", exact: true }).click();
  await page
    .getByRole("button", { name: "Cobertura por fecha", exact: true })
    .click();
  await page
    .getByLabel("Alumno para cobertura")
    .selectOption("browser-student@example.com");
  await visible(page.getByText(/Este alumno no tiene planes generados/));
  // Individual snapshots are created by the pupil's first sync, not by a trainer read.
  const pupilDevice = await browser.newContext();
  const pupil = await pupilDevice.newPage();
  await pupil.goto(origin);
  await pupil
    .getByLabel("Correo", { exact: true })
    .fill("browser-student@example.com");
  await pupil
    .getByLabel("Contraseña", { exact: true })
    .fill("synthetic-browser-password");
  await pupil.getByRole("button", { name: "Entrar", exact: true }).click();
  await visible(pupil.getByRole("heading", { name: "Tu repertorio" }));
  await pupilDevice.close();
  await page.getByLabel("Alumno para cobertura").selectOption("");
  await page
    .getByLabel("Alumno para cobertura")
    .selectOption("browser-student@example.com");
  await visible(page.locator(".coverage-overview"));
  await page.getByLabel("Fecha de referencia").fill("2026-10-13");
  assert.equal(
    await page.locator(".coverage-overview dd").nth(1).innerText(),
    "1",
  );
  await page.getByLabel("Incluir entrenamientos de ese día").uncheck();
  assert.equal(
    await page.locator(".coverage-overview dd").nth(1).innerText(),
    "0",
  );
  await page.getByLabel("Incluir entrenamientos de ese día").check();
  for (const width of [360, 390, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      `Coverage overflows at ${width}px`,
    );
    await page.evaluate(() => scrollTo(0, 0));
    await page.waitForTimeout(180);
    await page.screenshot({
      path: `.browser-artifacts/coverage-${width}.png`,
      fullPage: false,
    });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "Salir", exact: true }).click();
  await visible(page.getByRole("button", { name: "Entrar", exact: true }));
  await login("browser-student@example.com");
  await visible(page.getByRole("heading", { name: "Tu repertorio" }));
  assert.equal(
    await page
      .getByRole("button", { name: "Cobertura por fecha", exact: true })
      .count(),
    0,
  );
  await page.getByRole("button", { name: /Mis planes/ }).click();
  await visible(page.getByRole("heading", { name: "Torneo · 2026-10-23" }));
  assert.match(await page.locator(".timer").innerText(), /32:10/);
  await context.setOffline(true);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar PDF" }).click();
  const pdf = await download;
  await pdf.saveAs(".browser-artifacts/plan.pdf");
  assert.ok((await readFile(".browser-artifacts/plan.pdf")).length > 10000);
  await page.locator(".session summary").first().click();
  assert.equal(await page.getByLabel("Editar descripción del plan").count(), 0);
  assert.equal(
    await page.locator(".plan-card textarea, .plan-card input").count(),
    0,
  );
  await context.setOffline(false);
  await sync();
  const planFile = [...files].find(([k]) =>
    k.includes("/browser-student@example.com/training_plans/"),
  );
  const copiedEntries = await page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const r = indexedDB.open("pgt-active-user-v1");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const result = await new Promise((resolve, reject) => {
      const tx = database.transaction("entries", "readonly"),
        r = tx.objectStore("entries").getAll();
      r.onsuccess = () =>
        resolve(r.result.map(({ key, data }) => ({ key, data })));
      r.onerror = () => reject(r.error);
    });
    database.close();
    return result;
  });
  copiedEntries.find((e) =>
    e.key.startsWith("plan:"),
  ).data.sessions[0].exercises[0].descripcion_del_alumno = "Copia no permitida";
  await page.getByLabel("Restaurar copia propia").setInputFiles({
    name: "readonly-backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        mail: "browser-student@example.com",
        entries: copiedEntries,
      }),
    ),
  });
  await page
    .getByRole("status")
    .filter({ hasText: /planes de solo lectura/ })
    .waitFor();
  await sync();
  assert.ok(
    !JSON.stringify(files.get(planFile[0])).includes("Copia no permitida"),
  );
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: ".browser-artifacts/plan-readonly-desktop.png",
  });
  await page.setViewportSize({ width: 390, height: 900 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({
    path: ".browser-artifacts/plan-readonly-mobile.png",
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  // Old pending plan drafts are preserved for export, but never sent to the API.
  const readonlyCloudPlan = JSON.stringify(files.get(planFile[0]));
  await page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const r = indexedDB.open("pgt-active-user-v1");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    await new Promise((resolve, reject) => {
      const tx = database.transaction("entries", "readwrite"),
        store = tx.objectStore("entries");
      const request = store.getAll();
      request.onsuccess = () => {
        const entry = request.result.find((e) => e.key.startsWith("plan:"));
        entry.data.sessions[0].exercises[0].descripcion_del_alumno =
          "Borrador heredado";
        entry.dirty = true;
        store.put(entry);
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    database.close();
  });
  await page.getByRole("button", { name: "Sincronizar", exact: true }).click();
  await visible(page.locator(".conflict"));
  assert.equal(JSON.stringify(files.get(planFile[0])), readonlyCloudPlan);
  assert.equal(
    await page
      .locator(".conflict")
      .getByRole("button", { name: "Conservar mi versión" })
      .count(),
    0,
  );
  const legacyDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Exportar mi copia JSON", exact: true })
    .click();
  await (await legacyDownload).saveAs(".browser-artifacts/legacy-draft.json");
  assert.ok(
    (await readFile(".browser-artifacts/legacy-draft.json", "utf8")).includes(
      "Borrador heredado",
    ),
  );
  await page.getByRole("button", { name: "Usar remoto en conflictos" }).click();
  await sync();
  assert.equal(await page.locator(".conflict").count(), 0);
  // PRO 01: profile stays mounted on two independent devices during synchronization.
  const profileDevice = await browser.newContext();
  const mirror = await profileDevice.newPage();
  await mirror.goto(origin);
  await mirror
    .getByLabel("Correo", { exact: true })
    .fill("browser-student@example.com");
  await mirror
    .getByLabel("Contraseña", { exact: true })
    .fill("synthetic-browser-password");
  await mirror.getByRole("button", { name: "Entrar", exact: true }).click();
  await visible(mirror.getByRole("heading", { name: "Tu repertorio" }));
  // Future text projections are visible offline and converge on both devices after sync.
  const todayMadrid = madridDate();
  const savedPlan = structuredClone(planFile[1].data);
  const futureSessionIndex = savedPlan.sessions.findIndex(
    (s) => s.date > todayMadrid,
  );
  assert.ok(futureSessionIndex >= 0);
  const futureId =
    savedPlan.sessions[futureSessionIndex].exercises[0].techniqueId;
  const sourceIndex = files
    .get("PGT/users_data/browser-student@example.com/tecnics.json")
    .data.positions.flatMap((p) => p.tecnicas)
    .findIndex((t) => t.id === futureId);
  await context.setOffline(true);
  await page.getByRole("button", { name: "Mis técnicas", exact: true }).click();
  await page
    .getByLabel("Descripción de técnica o enlace de vídeo")
    .nth(sourceIndex)
    .fill("Texto futuro offline");
  await page
    .getByRole("status")
    .filter({ hasText: /Cambios guardados/ })
    .waitFor();
  await page.getByRole("button", { name: /Mis planes/ }).click();
  await page.locator(".session summary").nth(futureSessionIndex).click();
  assert.equal(
    await page
      .locator(".session")
      .nth(futureSessionIndex)
      .locator(".plan-description")
      .first()
      .innerText(),
    "Texto futuro offline",
  );
  assert.deepEqual(files.get(planFile[0]).data, savedPlan); // no cloud write while offline
  await context.setOffline(false);
  await sync();
  await sync(mirror);
  const afterDescription = files.get(planFile[0]).data;
  assert.deepEqual(
    afterDescription.sessions.filter((s) => s.date <= todayMadrid),
    savedPlan.sessions.filter((s) => s.date <= todayMadrid),
  );
  for (const session of afterDescription.sessions)
    if (session.date > todayMadrid)
      for (const e of session.exercises)
        if (e.techniqueId === futureId)
          assert.equal(e.descripcion_del_alumno, "Texto futuro offline");
  await mirror.getByRole("button", { name: /Mis planes/ }).click();
  await mirror.locator(".session summary").nth(futureSessionIndex).click();
  assert.equal(
    await mirror
      .locator(".session")
      .nth(futureSessionIndex)
      .locator(".plan-description")
      .first()
      .innerText(),
    "Texto futuro offline",
  );
  // A trainer's authorised source update reaches pupil plans without regenerating them.
  const teacherAuth = await (
    await context.request.post(origin + "/api/app/login", {
      data: {
        mail: "browser-trainer@example.com",
        password: "synthetic-browser-password",
      },
    })
  ).json();
  const commentsFile = files.get(
    "PGT/users_data/browser-student@example.com/trainer_comments.json",
  );
  const commentData = {
    ...commentsFile.data,
    comments: [
      ...commentsFile.data.comments.filter((c) => c.techniqueId !== futureId),
      { techniqueId: futureId, comment: "Comentario para el futuro" },
    ],
  };
  const commentResponse = await context.request.put(
    origin + "/api/app/users/browser-student@example.com/comments",
    {
      headers: { Authorization: "Bearer " + teacherAuth.token },
      data: { data: commentData, sha: commentsFile.sha },
    },
  );
  assert.equal(commentResponse.status(), 200);
  await sync();
  await sync(mirror);
  await visible(
    mirror.getByText("Entrenador: Comentario para el futuro", { exact: true }),
  );
  assert.deepEqual(
    files.get(planFile[0]).data.sessions.filter((s) => s.date <= todayMadrid),
    savedPlan.sessions.filter((s) => s.date <= todayMadrid),
  );
  await context.request.post(origin + "/api/app/logout", {
    headers: { Authorization: "Bearer " + teacherAuth.token },
    data: {},
  });
  await mirror.getByRole("button", { name: "Perfil", exact: true }).click();
  await page.getByRole("button", { name: "Perfil", exact: true }).click();
  const weight = page.getByLabel("Peso (kg)");
  await weight.fill("-5");
  assert.equal(await weight.evaluate(el => el.validity.rangeUnderflow), true);
  await page.getByRole("button", {name: "Guardar en este dispositivo"}).click();
  assert.equal(await weight.evaluate(el => el.validity.valid), false);
  await weight.fill("");
  const businessBeforeProfile = JSON.stringify(
    [...files].filter(([k]) => !k.endsWith("user_data.json")),
  );
  const changedProfile = {
    Nombre: "Nombre M1",
    Apellidos: "Apellidos M1",
    "Fecha de nacimiento": "1992-08-24",
    "Peso (kg)": "74.5",
    Cinturón: "Negro",
  };
  for (const [label, value] of Object.entries(changedProfile)) {
    if (label === "Cinturón")
      await page.getByLabel(label, { exact: true }).selectOption(value);
    else await page.getByLabel(label, { exact: true }).fill(value);
  }
  await page
    .getByRole("button", { name: "Guardar en este dispositivo" })
    .click();
  await sync();
  await sync(mirror);
  await mirror.waitForFunction(
    () => document.querySelector("input[name=nombre]")?.value === "Nombre M1",
  );
  for (const [label, value] of Object.entries(changedProfile)) {
    assert.equal(
      await page.getByLabel(label, { exact: true }).inputValue(),
      value,
    );
    assert.equal(
      await mirror.getByLabel(label, { exact: true }).inputValue(),
      value,
    );
  }
  assert.equal(
    await mirror.locator("input[name=mail], select[name=perfil]").count(),
    0,
  );
  assert.equal(
    files.get("PGT/users_data/browser-student@example.com/user_data.json").data
      .perfil,
    "alumno",
  );
  await mirror
    .getByLabel("Nombre", { exact: true })
    .fill("Borrador M2 sin guardar");
  await page
    .getByLabel("Apellidos", { exact: true })
    .fill("Actualizados otra vez");
  await page
    .getByRole("button", { name: "Guardar en este dispositivo" })
    .click();
  await sync();
  await sync(mirror);
  await mirror.waitForFunction(
    () =>
      document.querySelector("input[name=apellidos]")?.value ===
      "Actualizados otra vez",
  );
  assert.equal(
    await mirror.getByLabel("Nombre", { exact: true }).inputValue(),
    "Borrador M2 sin guardar",
  );
  assert.equal(
    files.get("PGT/users_data/browser-student@example.com/user_data.json").data
      .nombre,
    "Nombre M1",
  );
  assert.equal(
    JSON.stringify([...files].filter(([k]) => !k.endsWith("user_data.json"))),
    businessBeforeProfile,
  );
  await profileDevice.close();
  const second = await context.newPage();
  await second.goto(origin);
  await visible(second.getByRole("heading", { name: "Tu repertorio" }));
  await page.getByRole("button", { name: "Salir", exact: true }).click();
  await visible(second.getByRole("button", { name: "Entrar", exact: true }));
  assert.equal(await second.locator(".position").count(), 0);
  await second.close();
  await login("browser-student@example.com");
  await visible(page.getByRole("heading", { name: "Tu repertorio" }));
  await page.getByRole("button", { name: "Perfil", exact: true }).click();
  await page
    .getByLabel("Contraseña nueva", { exact: true })
    .fill("synthetic-new-browser-password");
  await page
    .getByLabel("Repetir contraseña", { exact: true })
    .fill("synthetic-new-browser-password");
  await page.getByRole("button", { name: "Confirmar cambio remoto" }).click();
  await visible(page.getByRole("button", { name: "Entrar", exact: true }));
  assert.equal(await page.getByRole("alert").count(), 0);
  await page
    .getByLabel("Correo", { exact: true })
    .fill("browser-student@example.com");
  await page
    .getByLabel("Contraseña", { exact: true })
    .fill("synthetic-new-browser-password");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await visible(page.getByRole("heading", { name: "Tu repertorio" }));
  assert.equal(
    await page
      .getByLabel("Descripción de técnica o enlace de vídeo")
      .first()
      .inputValue(),
    "Edición offline",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator(".position").count(), 17);
  assert.equal(await page.locator("header").count(), 1);
  await page.screenshot({ path: ".browser-artifacts/mobile.png" });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Chromium local: registro, IndexedDB, offline/reload, pendientes/cambio A→B, restauración, entrenador/asignación, textos futuros offline y sincronizados entre dispositivos, plan de solo lectura/PDF offline, contraseña, dos pestañas y responsive 390px OK. Sin conexiones externas ni datos reales.",
  );
} finally {
  await context.close();
  await browser.close();
  await new Promise((r) => server.close(r));
}
