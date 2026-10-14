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
const api = new AppApi(store, cloud, { PROBE_ADMIN_KEY: "fixture-admin" });
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
  assert.equal(
    (
      await context.request.post(origin + "/api/app/bootstrap", {
        headers: { Authorization: "Bearer fixture-admin" },
        data: { mail: "browser-trainer@example.com" },
      })
    ).status(),
    200,
  );
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
  await page.locator("input[name=student]").check();
  await page
    .getByRole("button", { name: "Crear competición con configuración fija" })
    .click();
  await visible(page.getByRole("heading", { name: "Torneo · 2026-10-23" }));
  assert.deepEqual(
    await page.locator(".dashboard-overview dd").allTextContents(),
    ["1", "1", "1"],
  );
  await page.screenshot({
    path: ".browser-artifacts/trainer-competition.png",
    fullPage: true,
  });
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
  await page
    .getByLabel("Editar descripción del plan")
    .first()
    .fill("Plan manual offline");
  await context.setOffline(false);
  await sync();
  const planFile = [...files].find(([k]) =>
    k.includes("/browser-student@example.com/training_plans/"),
  );
  assert.equal(
    planFile[1].data.sessions[0].exercises[0].descripcion_del_alumno,
    "Plan manual offline",
  );
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
    "Chromium local: registro, IndexedDB, offline/reload, pendientes/cambio A→B, restauración, entrenador/asignación, plan/PDF offline, edición, contraseña, dos pestañas y responsive 390px OK. Sin conexiones externas ni datos reales.",
  );
} finally {
  await context.close();
  await browser.close();
  await new Promise((r) => server.close(r));
}
