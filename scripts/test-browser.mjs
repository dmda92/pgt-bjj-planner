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
    .filter({ hasText: /^(Sincronizado|Cambios en el perfil sin guardar)$/ })
    .waitFor({ timeout: 15000 });
}
try {
  await page.goto(origin);
  await register("browser-trainer@example.com", "Trainer");
  assert.equal(await page.locator(".position").count(), 17);
  // TEC 04: no numeric text entry; minimum 1, integer steps, stable UUID.
  const firstPosition = page.locator(".position").first();
  assert.equal(await firstPosition.locator('.priority input').count(), 0);
  assert.equal(await firstPosition.getByRole('button', {name:'Reducir prioridad'}).isDisabled(), true);
  const positionsFile = files.get('PGT/users_data/browser-trainer@example.com/tecnics.json');
  const originalId = positionsFile.data.positions[0].id;
  await firstPosition.getByRole('button', {name:'Aumentar prioridad'}).click();
  await firstPosition.locator('.priority output').filter({hasText:/^2$/}).waitFor();
  await firstPosition.getByRole('button', {name:'Reducir prioridad'}).click();
  await firstPosition.locator('.priority output').filter({hasText:/^1$/}).waitFor();
  assert.equal(await firstPosition.getByRole('button', {name:'Reducir prioridad'}).isDisabled(), true);
  await sync();
  assert.equal(files.get('PGT/users_data/browser-trainer@example.com/tecnics.json').data.positions[0].id, originalId);
  assert.equal(files.get('PGT/users_data/browser-trainer@example.com/tecnics.json').data.positions[0].prioridad, 1);

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
  assert.equal(await page.locator('.sync-success').count(),1);
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
  assert.equal(await page.locator('.sync-success').count(),0);
  assert.match(await page.locator('.sync [role="status"]').innerText(),/pendientes|Sin conexión/);
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
  let releaseStudent;
  const studentGate = new Promise(resolve => { releaseStudent=resolve; });
  const studentRoute='**/api/app/users/browser-student%40example.com/view?*';
  const delayedStudent=async route=>{await studentGate;await route.continue();};
  await page.route(studentRoute,delayedStudent);
  await page.getByRole("button", { name: /Student Fixture/ }).click();
  await visible(page.getByRole('status',{name:'Cargando alumno'}));
  assert.equal(await page.locator('.student-selected').count(),1);
  assert.equal(await page.getByText('Trabaja el juego de cada alumno.',{exact:true}).count(),0);
  await page.screenshot({path:'.browser-artifacts/student-loading.png'});
  releaseStudent();

  await visible(
    page.getByRole("heading", { name: "Student Fixture", exact: true }),
  );
  assert.equal(await page.locator(".student-selected").count(), 1);
  await page.unroute(studentRoute,delayedStudent);
  let releaseRefresh;const refreshGate=new Promise(resolve=>{releaseRefresh=resolve;});
  const slowRefresh=async route=>{await refreshGate;await route.continue();};
  await page.route(studentRoute,slowRefresh);
  const warmStart=Date.now();await page.getByRole('button',{name:/Student Fixture/}).click();
  await visible(page.getByRole('heading',{name:'Student Fixture',exact:true}));
  const warmRenderMs=Date.now()-warmStart;
  await visible(page.getByRole('status',{name:'Actualizando ficha'}));
  assert.equal(await page.getByRole('status',{name:'Cargando alumno'}).count(),0);
  releaseRefresh();await page.getByRole("status",{name:"Actualizando ficha"}).waitFor({state:"hidden"});await page.unroute(studentRoute,slowRefresh);await context.setOffline(true);
  await page.getByRole('button',{name:/Student Fixture/}).click();await visible(page.getByRole('heading',{name:'Student Fixture',exact:true}));
  assert.equal(await page.getByRole('status',{name:'Cargando alumno'}).count(),0);
  await context.setOffline(false);
  console.log(`Trainer warm React view: ${warmRenderMs} ms while remote request retained; cached offline view OK.`);

  const studentPanel=page.locator('.student-detail');
  assert.equal(await studentPanel.getByRole('button',{name:'Técnicas',exact:true}).getAttribute('aria-pressed'),'true');
  assert.equal(await studentPanel.getByLabel('Rol',{exact:true}).count(),0);
  await studentPanel.getByRole('button',{name:'Planes',exact:true}).click();
  await visible(studentPanel.getByText('Este alumno todavía no tiene planes asignados.',{exact:true}));
  assert.equal(await studentPanel.getByLabel('Buscar posición del alumno').count(),0);
  await studentPanel.getByRole('button',{name:'Administración',exact:true}).click();
  await visible(studentPanel.getByLabel('Rol',{exact:true}));
  await visible(studentPanel.getByRole('heading',{name:'Restablecer contraseña del alumno',exact:true}));
  assert.equal(await studentPanel.locator('.plan-card').count(),0);
  await studentPanel.getByLabel('Rol',{exact:true}).selectOption('entrenador');
  await page.waitForFunction(()=>document.querySelector('select[aria-label="Rol"]')?.value==='entrenador'&&!document.querySelector('select[aria-label="Rol"]')?.disabled);
  assert.equal(files.get('PGT/users_data/browser-student@example.com/user_data.json').data.perfil,'entrenador');
  await studentPanel.getByLabel('Rol',{exact:true}).selectOption('alumno');
  await page.waitForFunction(()=>document.querySelector('select[aria-label="Rol"]')?.value==='alumno'&&!document.querySelector('select[aria-label="Rol"]')?.disabled);
  assert.equal(files.get('PGT/users_data/browser-student@example.com/user_data.json').data.perfil,'alumno');

  await page.getByRole('button',{name:/Student Fixture/}).click();
  await visible(studentPanel.getByLabel('Buscar posición del alumno'));
  assert.equal(await studentPanel.getByRole('button',{name:'Técnicas',exact:true}).getAttribute('aria-pressed'),'true');

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
  const readonlyDescription=page.getByLabel('Descripción del alumno',{exact:true}).first();
  assert.equal(await readonlyDescription.evaluate(el=>el.readOnly),true);
  assert.equal(await readonlyDescription.inputValue(),'Edición offline');
  await page.locator('.student-detail').screenshot({path:'.browser-artifacts/student-readonly-description.png'});

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
  let createRequests=0;
  page.on('request',request=>{if(new URL(request.url()).pathname==='/api/app/competition')createRequests++;});
  const endDate=page.getByLabel('Fecha del torneo',{exact:true});
  for(const invalidEnd of ['2026-10-13','2026-10-12','2030-10-23']) {
    await endDate.fill(invalidEnd);
    await page.locator('.competition-create').getByRole('button',{name:'Crear competición',exact:true}).click();
    assert.equal(await endDate.getAttribute('aria-invalid'),'true');
    assert.equal(await endDate.evaluate(el=>el.validity.valid),false);
    assert.equal(createRequests,0);
    await visible(page.locator('#competition-end-error'));
  }
  await page.getByLabel("Fecha del torneo", { exact: true }).fill("2026-10-23");
  assert.equal(await endDate.evaluate(el=>el.validity.valid),true);
  assert.equal(await page.locator('#competition-end-error').count(),0);
  for(const label of ['Cambio de roles (s)','Entre técnicas (s)']) {
    const input=page.getByLabel(label,{exact:true});
    await input.fill('0');
    await page.locator('.competition-create').getByRole('button',{name:'Crear competición',exact:true}).click();
    assert.equal(await input.evaluate(el=>el.validity.rangeUnderflow),true);
    assert.equal(createRequests,0);
    await input.fill('1');
    assert.equal(await input.evaluate(el=>el.validity.valid),true);
  }
  await page.getByLabel('Cambio de roles (s)',{exact:true}).fill('10');
  await page.getByLabel('Entre técnicas (s)',{exact:true}).fill('20');
  assert.equal(await page.locator("input[name=student]").count(), 2);
  await page
    .locator('input[name=student][value="browser-student@example.com"]')
    .check();
  await page
    .locator('input[name=student][value="browser-trainer@example.com"]')
    .check();
  let releaseCompetition;const competitionGate=new Promise(resolve=>{releaseCompetition=resolve;});
  const competitionRoute='**/api/app/competition';
  const delayedCompetition=async route=>{await competitionGate;await route.continue();};
  await page.route(competitionRoute,delayedCompetition);
  await page
    .locator(".competition-create")
    .getByRole("button", { name: "Crear competición", exact: true })
    .click();
  await visible(page.getByRole('status',{name:'Creando competición'}));
  await page.locator('.competition-create').screenshot({path:'.browser-artifacts/competition-loading.png'});
  assert.equal(await page.locator('.competition-create').getByRole('button',{name:'Crear competición',exact:true}).isDisabled(),true);
  releaseCompetition();
  await visible(page.getByRole("heading", { name: "Torneo · 2026-10-23" }));
  await page.getByRole('status',{name:'Creando competición'}).waitFor({state:'hidden'});
  await page.unroute(competitionRoute,delayedCompetition);

  await sync(); // Download the trainer participant plan before removing its assignment.
  // Draft selections are immediate; remote changes occur only on explicit save.
  const card=page.locator('.competition-card').first();
  const participant=card.getByRole('checkbox').first();
  const saveParticipants=card.getByRole('button',{name:'Guardar datos',exact:true});
  let assignmentRequests=0;
  await page.route('**/api/app/assignment',async route=>{assignmentRequests++;await route.continue();});
  assert.equal(await saveParticipants.isDisabled(),true);
  await participant.click();
  assert.equal(await participant.isChecked(),false);
  assert.equal(await saveParticipants.isEnabled(),true);
  assert.equal(assignmentRequests,0);
  await participant.click();
  assert.equal(await saveParticipants.isDisabled(),true);
  await participant.click();
  await saveParticipants.click();
  await page.waitForFunction(() => [...document.querySelectorAll('.dashboard-overview dd')].at(-1)?.textContent === '1');
  await saveParticipants.waitFor({state:'visible'});
  assert.equal(await participant.isChecked(),false);
  await page.waitForFunction(()=>document.querySelector('.competition-card button')?.disabled);
  await sync();
  const localPlanCount=await page.evaluate(async()=>{
    const request=indexedDB.open('pgt-active-user-v1');
    const database=await new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    const read=database.transaction('entries','readonly').objectStore('entries').getAll();
    const entries=await new Promise((resolve,reject)=>{read.onsuccess=()=>resolve(read.result);read.onerror=()=>reject(read.error);});
    database.close();return entries.filter(entry=>entry.key.startsWith('plan:')).length;
  });
  assert.equal(localPlanCount,0,'Desasignación elimina el plan previamente descargado tras sincronizar');

  await participant.click();
  assert.equal(await participant.isChecked(),true);
  await saveParticipants.click();
  await page.waitForFunction(() => [...document.querySelectorAll('.dashboard-overview dd')].at(-1)?.textContent === '2');
  assert.equal(assignmentRequests,2);
  // A second competition lets us verify deletion feedback without affecting later fixtures.
  await page.locator('.competition-create').getByRole('button',{name:'Crear competición',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.competition-card').length===2);
  let releaseDelete;
  const deleteGate=new Promise(resolve=>{releaseDelete=resolve;});
  const deleteRoute='**/api/app/delete-competition';
  const delayedDelete=async route=>{await deleteGate;await route.continue();};
  await page.route(deleteRoute,delayedDelete);
  const deletingCard=page.locator('.competition-card').last();
  await deletingCard.getByRole('button',{name:'Borrar competición completa',exact:true}).click();
  await visible(deletingCard.getByRole('status',{name:'Borrando competición'}));
  assert.equal(await deletingCard.getByRole('button',{name:'Borrar competición completa',exact:true}).isDisabled(),true);
  assert.equal(await deletingCard.getByRole('checkbox').first().isDisabled(),true);
  await deletingCard.screenshot({path:'.browser-artifacts/competition-deleting.png'});
  releaseDelete();
  await page.waitForFunction(()=>document.querySelectorAll('.competition-card').length===1);
  await page.unroute(deleteRoute,delayedDelete);


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
  await page.getByRole('button',{name:'Equipo',exact:true}).click();
  await page.getByRole('button',{name:/Trainer Fixture/}).click();
  await visible(page.locator('.student-detail').getByRole('button',{name:'Planes',exact:true}));
  await page.locator('.student-detail').getByRole('button',{name:'Planes',exact:true}).click();
  await visible(page.getByLabel('Plan del alumno',{exact:true}));
  assert.equal(await page.locator('.student-detail .plan-card').count(),0);
  const selectedPlan=await page.getByLabel('Plan del alumno',{exact:true}).locator('option').nth(1).getAttribute('value');
  await page.getByLabel('Plan del alumno',{exact:true}).selectOption(selectedPlan);
  await visible(page.locator('.student-detail .plan-card'));
  assert.equal(await page.locator('.student-detail .plan-card').count(),1);
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

  // Long descriptions: retry a failed synchronization without logout or clearing IndexedDB.
  const largeContext = await browser.newContext();
  const largePage = await largeContext.newPage();
  await largePage.goto(origin);
  await largePage.getByRole('button',{name:'Registrarme',exact:true}).click();
  await largePage.getByLabel('Correo',{exact:true}).fill('browser-large@example.com');
  await largePage.getByLabel('Nombre',{exact:true}).fill('Large');
  await largePage.getByLabel('Apellidos',{exact:true}).fill('Fixture');
  await largePage.getByLabel('Contraseña',{exact:true}).fill('synthetic-browser-password');
  await largePage.getByLabel('Repetir contraseña',{exact:true}).fill('synthetic-browser-password');
  await largePage.getByRole('button',{name:'Crear cuenta de alumno',exact:true}).click();
  await visible(largePage.getByRole('heading',{name:'Tu repertorio'}));
  const longText=('Ángulo 日本語 🙂 https://video.example/watch?v=é&x=1\n').repeat(400);
  for(let i=0;i<9;i++) await largePage.getByLabel('Descripción de técnica o enlace de vídeo').nth(i).fill(`${i}: ${longText}`);
  let rejected=false;
  const routePattern='**/api/app/users/*/techniques';
  await largeContext.route(routePattern,async route=>{
    const bytes=new TextEncoder().encode(JSON.stringify(route.request().postDataJSON().data)).length;
    rejected=true;
    await route.fulfill({status:413,contentType:'application/json',body:JSON.stringify({error:'JSON_TOO_LARGE',size:{file:'tecnics.json',bytes,limitBytes:65536,scope:'document',exact:true}})});
  });
  await largePage.getByRole('button',{name:'Sincronizar',exact:true}).click();
  await largePage.getByRole('alert').filter({hasText:'tecnics.json'}).waitFor();
  assert.equal(rejected,true);
  assert.match(await largePage.getByRole('alert').innerText(),/bytes/);
  for(let i=0;i<9;i++)assert.equal(await largePage.getByLabel('Descripción de técnica o enlace de vídeo').nth(i).inputValue(),`${i}: ${longText}`);
  await largeContext.unroute(routePattern);
  await largePage.getByRole('button',{name:'Sincronizar',exact:true}).click();
  await largePage.getByRole('status').filter({hasText:/^Sincronizado$/}).waitFor();
  await largePage.reload();
  await visible(largePage.getByRole('heading',{name:'Tu repertorio'}));
  for(let i=0;i<9;i++)assert.equal(await largePage.getByLabel('Descripción de técnica o enlace de vídeo').nth(i).inputValue(),`${i}: ${longText}`);
  const restoredContext=await browser.newContext();const restoredPage=await restoredContext.newPage();
  await restoredPage.goto(origin);
  await restoredPage.getByLabel('Correo',{exact:true}).fill('browser-large@example.com');
  await restoredPage.getByLabel('Contraseña',{exact:true}).fill('synthetic-browser-password');
  await restoredPage.getByRole('button',{name:'Entrar',exact:true}).click();
  await visible(restoredPage.getByRole('heading',{name:'Tu repertorio'}));
  for(let i=0;i<9;i++)assert.equal(await restoredPage.getByLabel('Descripción de técnica o enlace de vídeo').nth(i).inputValue(),`${i}: ${longText}`);
  await restoredContext.close();await largeContext.close();
  // Deletions recalculate locally while offline; reload and a second device retain the same suffix.
  await page.getByRole('button',{name:'Mis técnicas',exact:true}).click();
  const deletionBefore=structuredClone(files.get(planFile[0]).data);
  const techBefore=structuredClone(files.get('PGT/users_data/browser-student@example.com/tecnics.json').data);
  const deletedId=techBefore.positions[0].tecnicas[0].id;
  await context.setOffline(true);
  await page.getByRole('button',{name:'Borrar técnica',exact:true}).first().click();
  await page.getByRole('status').filter({hasText:/Cambios guardados/}).waitFor();
  const localPlan=await page.evaluate(async id=>{
    const req=indexedDB.open('pgt-active-user-v1');const database=await new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
    const read=database.transaction('entries','readonly').objectStore('entries').get('plan:'+id);
    const value=await new Promise((resolve,reject)=>{read.onsuccess=()=>resolve(read.result);read.onerror=()=>reject(read.error);});database.close();return value.data;
  },deletionBefore.planId);
  assert.equal(localPlan.structuralUpdateError,undefined);
  assert.deepEqual(localPlan.sessions.filter(s=>s.date<=todayMadrid),deletionBefore.sessions.filter(s=>s.date<=todayMadrid));
  assert.ok(localPlan.sessions.filter(s=>s.date>todayMadrid).every(s=>s.exercises.length===deletionBefore.ejercicios_por_sesion&&s.exercises.every(e=>e.techniqueId!==deletedId)));
  assert.deepEqual(files.get(planFile[0]).data,deletionBefore);
  await page.reload();await visible(page.getByRole('heading',{name:'Tu repertorio'}));
  await context.setOffline(false);await sync();
  const deletedRemote=structuredClone(files.get(planFile[0]).data);
  assert.deepEqual(deletedRemote.sessions,localPlan.sessions);
  const deletionDevice=await browser.newContext();const deletionMirror=await deletionDevice.newPage();
  await deletionMirror.goto(origin);
  await deletionMirror.getByLabel('Correo',{exact:true}).fill('browser-student@example.com');
  await deletionMirror.getByLabel('Contraseña',{exact:true}).fill('synthetic-new-browser-password');
  await deletionMirror.getByRole('button',{name:'Entrar',exact:true}).click();await visible(deletionMirror.getByRole('heading',{name:'Tu repertorio'}));
  assert.equal(await deletionMirror.getByRole('button',{name:'Borrar técnica',exact:true}).count(),techBefore.positions.flatMap(p=>p.tecnicas).length-1);
  await sync(deletionMirror);assert.deepEqual(files.get(planFile[0]).data,deletedRemote);
  const mirroredPlan=await deletionMirror.evaluate(async id=>{
    const req=indexedDB.open('pgt-active-user-v1');const database=await new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
    const read=database.transaction('entries','readonly').objectStore('entries').get('plan:'+id);
    const value=await new Promise((resolve,reject)=>{read.onsuccess=()=>resolve(read.result);read.onerror=()=>reject(read.error);});database.close();return value.data;
  },deletedRemote.planId);
  assert.deepEqual(mirroredPlan.sessions,deletedRemote.sessions);
  await deletionDevice.close();
  // Empty catalogue: preserve the previous plan, show a recoverable warning, never report complete sync.
  await page.getByRole('button',{name:'Mis técnicas',exact:true}).click();
  for(let count=await page.getByRole('button',{name:'Eliminar posición',exact:true}).count();count>0;count--){
    await page.getByRole('button',{name:'Eliminar posición',exact:true}).first().click();
    await page.waitForFunction(expected=>document.querySelectorAll('.position').length===expected,count-1);
    await page.getByRole('status').filter({hasText:/Cambios guardados/}).waitFor();
  }
  await page.getByRole('button',{name:'Sincronizar',exact:true}).click();
  await page.getByRole('status').filter({hasText:/Sincronización incompleta:.*actualización bloqueada/}).waitFor();
  await page.getByRole('button',{name:/Mis planes/}).click();
  await visible(page.getByRole('alert').filter({hasText:/Actualización del plan bloqueada/}).first());
  assert.match(files.get(planFile[0]).data.structuralUpdateError,/No quedan técnicas/);

  assert.deepEqual(errors, []);
  console.log(
    "Chromium local: registro, IndexedDB, offline/reload, pendientes/cambio A→B, restauración, entrenador/asignación, textos futuros y borrados offline sincronizados entre dispositivos, plan de solo lectura/PDF offline, contraseña, dos pestañas y responsive 390px OK. Sin conexiones externas ni datos reales.",
  );
} finally {
  await context.close();
  await browser.close();
  await new Promise((r) => server.close(r));
}
