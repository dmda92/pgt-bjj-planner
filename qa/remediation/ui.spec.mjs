import {test, expect} from '@playwright/test';
import {createLocalAcademy} from '../playwright/helpers/local-academy.mjs';
import {competition, operation, userPath, editor, cachedIdentitySummary, exportedCopy} from '../playwright/helpers/fault-contracts.mjs';

async function team(page, a) {
  await a.login(page, a.trainer.profile.mail);
  await page.getByRole('button', {name: 'Entrenador', exact: true}).click();
  await page.getByRole('button', {name: 'Equipo', exact: true}).click();
}
async function select(page, u) {
  await page.locator('.student-card').filter({hasText: u.profile.nombre + ' ' + u.profile.apellidos}).click();
  await expect(page.locator('.student-detail')).toContainText(u.profile.mail);
}
async function evidence(info, name, data) {
  await info.attach(name, {body: JSON.stringify(data, null, 2), contentType: 'application/json'});
}

test('ENT06: late comment completion preserves selected pupil B and A draft after HTTP failure', async ({page}, info) => {
  const a = await createLocalAcademy();
  let release = () => {};
  try {
    const u = await a.register('ent06-a'), v = await a.register('ent06-b');
    const beforeB = await a.call(userPath(v, 'snapshot'), undefined, v.token);
    await team(page, a); await select(page, u);
    await page.locator('.student-detail details.repertoire-position').first().locator('summary').click();
    const box = page.getByLabel('Comentario', {exact: true}).first();
    const save = box.locator('..').getByRole('button', {name: 'Guardar comentario remoto', exact: true});
    const text = 'ENT06 retained synthetic draft';
    await box.fill(text);
    await page.route('**/api/v2/commands/comments', route => route.fulfill({status: 503, contentType: 'application/json', body: '{"error":"QA_INJECTED_FAILURE"}'}), {times: 1});
    const failure = page.waitForResponse(r => r.url().endsWith('/commands/comments'));
    await save.click(); expect((await failure).status()).toBe(503);
    await expect(box).toHaveValue(text); await expect(save).toBeEnabled();
    let entered;
    const gate = new Promise(r => release = r), seen = new Promise(r => entered = r);
    await page.route('**/api/v2/commands/comments', async route => {entered(); await gate; await route.continue();}, {times: 1});
    const completed = page.waitForResponse(r => r.url().endsWith('/commands/comments'));
    await save.click(); await seen; await select(page, v);
    const late = [];
    page.on('response', r => {if(r.url().includes('/users/' + encodeURIComponent(u.profile.mail) + '/')) late.push(new URL(r.url()).pathname);});
    release(); expect((await completed).status()).toBe(200);
    // Poll the authoritative source to ensure the held write committed before checking its UI completion.
    await expect.poll(async () => (await a.call(userPath(u, 'comments'), undefined, a.trainer.token)).data.comments.some(c => c.comment === text)).toBe(true);
    await expect(page.getByRole('status', {name: 'Guardando comentario', exact: true})).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(await a.call(userPath(v, 'snapshot'), undefined, v.token)).toEqual(beforeB);
    await evidence(info, 'late-save', {late, selected: await page.locator('.student-card[aria-pressed=true]').innerText(), heading: await page.locator('.student-detail-heading').innerText()});
    await expect(page.locator('.student-detail')).toContainText(v.profile.mail);
    await expect(page.locator('.student-detail')).not.toContainText(u.profile.mail);
  } finally {release(); await a.close();}
});

for (const emptyPosition of [false, true]) test(`GEN10: ${emptyPosition ? 'position without techniques' : 'empty catalogue'} explains missing trainable techniques`, async ({page}, info) => {
  const a = await createLocalAcademy();
  try {
    const u = await a.register('gen10-empty'), base = await a.call(userPath(u), undefined, u.token);
    const positions = emptyPosition ? [{id: crypto.randomUUID(), posicion: 'Empty position', prioridad: 1, tecnicas: []}] : [];
    await a.call('commands/repertoire', operation({...base.data, positions}, base.version), u.token);
    await competition(a, [u]);
    const snapshot = await a.call(userPath(u, 'snapshot'), undefined, u.token);
    expect(snapshot.plans).toEqual([]); expect(snapshot.pendingPlanIds).toHaveLength(1);
    await a.login(page, u.profile.mail);
    await page.getByRole('button', {name: /^Mis planes/}).click();
    await expect(page.locator('.sync-success')).toHaveCount(0);
    await expect(page.locator('.plan-card')).toHaveCount(0);
    await evidence(info, 'empty-plan-recovery', {snapshot, body: await page.locator('body').innerText()});
    await expect(page.locator('body')).toContainText(/no (?:hay|quedan|tienes).*t[eé]cnicas entrenables|cat[aá]logo.*vac[ií]o/i);
    await expect(page.locator('body')).not.toContainText('Solicita a tu entrenador que te asigne');
  } finally {await a.close();}
});

test('REN02: independent trainer sources start while profile response is held; plans stay on demand', async ({page}, info) => {
  const a = await createLocalAcademy();
  let release = () => {};
  try {
    const u = await a.register('ren02-pupil'); await competition(a, [u]); await competition(a, [u]);
    const before = await a.call(userPath(u, 'snapshot'), undefined, u.token);
    await team(page, a);
    const costBefore = a.f.metrics();
    let entered; const gate = new Promise(r => release = r), seen = new Promise(r => entered = r);
    const requests = [];
    page.on('request', req => {if (req.url().includes('/users/' + encodeURIComponent(u.profile.mail) + '/')) requests.push(new URL(req.url()).pathname);});
    await page.route('**/api/v2/users/' + encodeURIComponent(u.profile.mail) + '/profile', async route => {entered(); await gate; await route.continue();}, {times: 1});
    await page.locator('.student-card').filter({hasText: u.profile.nombre + ' ' + u.profile.apellidos}).click();
    await seen;
    try {
      await expect.poll(() => ['repertoire', 'comments'].every(kind => requests.some(path => path.endsWith('/' + kind))), {timeout: 3000, message: 'Repertoire and comments must start before the held profile completes'}).toBe(true);
      for (const kind of ['profile','repertoire','comments']) expect(requests.filter(path => path.endsWith('/'+kind))).toHaveLength(1);
    } finally {await evidence(info, 'sources-before-profile-release', requests); release();}
    await expect(page.locator('.student-detail')).toContainText(u.profile.mail);
    await page.locator('.student-sections').getByRole('button', {name: 'Planes', exact: true}).click();
    await page.getByLabel('Plan del alumno', {exact: true}).waitFor();
    expect(requests.filter(path => /\/plans\/[^/]+$/.test(path))).toHaveLength(0);
    await page.getByLabel('Plan del alumno', {exact: true}).selectOption(before.plans[0].data.planId);
    await expect(page.locator('.plan-card')).toBeVisible();
    expect(requests.filter(path => /\/plans\/[^/]+$/.test(path))).toHaveLength(1);
    expect(await a.call(userPath(u, 'snapshot'), undefined, u.token)).toEqual(before);
    const costAfter = a.f.metrics();
    expect(costAfter.attemptedWrites-costBefore.attemptedWrites).toBe(0);
    expect(costAfter.estimatedReads-costBefore.estimatedReads).toBe(0);
    await evidence(info,'warm-navigation-budget',{estimatedReads:0,attemptedWrites:0,techniqueRequests:3,selectedPlanRequests:1});
  } finally {release(); await a.close();}
});

test('CON09: removed plan leaves UI while failed technique draft stays intact', async ({page}, info) => {
  const a = await createLocalAcademy();
  try {
    const u = await a.register('con09-pupil'), plan = await competition(a, [u]);
    const catalog = await a.call('catalog', undefined, a.trainer.token);
    await a.login(page, u.profile.mail);
    await page.getByRole('button', {name: /^Mis planes/}).click();
    await page.getByLabel('Mi plan', {exact: true}).selectOption(plan.planId);
    await page.getByRole('button', {name: 'Mis técnicas', exact: true}).click();
    const input = await editor(page), text = 'CON09 synthetic failed draft retained';
    await page.route('**/api/v2/commands/repertoire', route => route.fulfill({status: 500, contentType: 'application/json', body: '{"error":"QA_FAILED_DRAFT"}'}));
    await input.fill(text);
    await page.getByRole('button', {name: 'Reintentar guardado', exact: true}).waitFor();
    await page.getByRole('button', {name: /^Mis planes/}).click();
    await page.context().setOffline(true);
    await a.call('commands/assignment', {planId: plan.planId, alumnos: [], expected: catalog.version, operationId: crypto.randomUUID()}, a.trainer.token);
    await page.context().setOffline(false);
    await expect.poll(async () => (await cachedIdentitySummary(page)).entryKeys.some(k => k.startsWith('plan:'))).toBe(false);
    expect((await a.call(userPath(u, 'snapshot'), undefined, u.token)).plans).toEqual([]);
    await evidence(info, 'removed-plan-ui', {body: await page.locator('body').innerText()});
    await expect.soft(page.getByLabel('Mi plan', {exact: true})).toHaveCount(0);
    await page.getByRole('button', {name: 'Mis técnicas', exact: true}).click();
    await expect(await editor(page)).toHaveValue(text);
  } finally {await a.close();}
});

test('PLA04: legacy manual plan stays exportable and replacement requires explicit review', async ({page}, info) => {
  const a = await createLocalAcademy();
  try {
    const u = await a.register('pla04-pupil'), plan = await competition(a, [u]);
    const before = await a.call(userPath(u, 'plans/' + plan.planId), undefined, u.token);
    await a.login(page, u.profile.mail);
    await page.getByRole('button', {name: /^Mis planes/}).click();
    await page.getByLabel('Mi plan', {exact: true}).selectOption(plan.planId);
    await page.locator('.plan-card').waitFor();
    await page.evaluate(async ({mail, id}) => {
      const db = await new Promise((resolve, reject) => {const r = indexedDB.open('pgt-active-user-v1'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);});
      await new Promise((resolve, reject) => {
        const tx = db.transaction('entries', 'readwrite'), store = tx.objectStore('entries'), r = store.getAll();
        r.onsuccess = () => {const entry = r.result.find(e => e.mail === mail && e.key === 'plan:' + id); if(!entry) return reject(Error('Downloaded plan missing')); entry.data.sessions[0].exercises[0].tipo = 'LEGACY MANUAL DRAFT'; store.put({...entry, dirty: true});};
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
      }); db.close();
    }, {mail: u.profile.mail, id: plan.planId});
    let commands = 0; page.on('request', req => {if(req.url().includes('/commands/')) commands++;});
    await page.reload(); await page.getByRole('heading', {name: 'Tu repertorio'}).waitFor();
    const copy = await exportedCopy(page);
    expect(JSON.stringify(copy.legacyDrafts)).toContain('LEGACY MANUAL DRAFT');
    expect(await a.call(userPath(u, 'plans/' + plan.planId), undefined, u.token)).toEqual(before);
    expect(commands).toBe(0);
    await evidence(info, 'legacy-plan-export', {copy, commands, body: await page.locator('body').innerText()});
    await expect(page.locator('[role=alert]').filter({hasText: /borrador.*plan|plan.*borrador/i})).toBeVisible();
    await expect(page.getByRole('button', {name: /revisar.*plan|cargar.*plan|usar.*plan/i})).toBeVisible();
  } finally {await a.close();}
});

test('SYN08: failed comment survives pupil switch and reload without automatic upload', async ({page}, info) => {
  const a = await createLocalAcademy();
  try {
    const u = await a.register('syn08-a'), v = await a.register('syn08-b');
    await team(page, a); await select(page, u);
    await page.locator('.student-detail details.repertoire-position').first().locator('summary').click();
    const text = 'SYN08 persistent synthetic comment';
    const box = page.getByLabel('Comentario', {exact: true}).first();
    await box.fill(text);
    await page.route('**/api/v2/commands/comments', route => route.fulfill({status: 503, contentType: 'application/json', body: '{"error":"QA_COMMENT_FAILURE"}'}), {times: 1});
    const failed = page.waitForResponse(r => r.url().endsWith('/commands/comments'));
    await box.locator('..').getByRole('button', {name: 'Guardar comentario remoto', exact: true}).click();
    expect((await failed).status()).toBe(503); await expect(box).toHaveValue(text);
    await select(page, v); await select(page, u);
    await page.locator('.student-detail details.repertoire-position').first().locator('summary').click();
    await expect.soft(page.getByLabel('Comentario', {exact: true}).first()).toHaveValue(text);
    let commands = 0; page.on('request', req => {if(req.url().endsWith('/commands/comments')) commands++;});
    await page.reload(); await page.getByRole('heading', {name: 'Tu repertorio'}).waitFor();
    await page.getByRole('button', {name: 'Entrenador', exact: true}).click();
    await page.getByRole('button', {name: 'Equipo', exact: true}).click(); await select(page, u);
    await page.locator('.student-detail details.repertoire-position').first().locator('summary').click();
    const restored = page.getByLabel('Comentario', {exact: true}).first();
    await expect(restored).toHaveValue(text); expect(commands).toBe(0);
    const source = await a.call(userPath(u, 'comments'), undefined, a.trainer.token);
    expect(source.data.comments.some(c => c.comment === text)).toBe(false);
    await evidence(info, 'restored-comment', {commands, remoteUnchanged: true});
    await restored.scrollIntoViewIfNeeded();
    await page.screenshot({path: info.outputPath('comment-draft-desktop.png')});
    await page.setViewportSize({width: 390, height: 844});
    await restored.scrollIntoViewIfNeeded();
    await page.screenshot({path: info.outputPath('comment-draft-mobile.png')});
    await page.setViewportSize({width: 1440, height: 1000});
    const saved = page.waitForResponse(r => r.url().endsWith('/commands/comments'));
    await restored.locator('..').getByRole('button', {name: 'Guardar comentario remoto', exact: true}).click();
    expect((await saved).status()).toBe(200);
    await expect.poll(async () => (await a.call(userPath(u, 'comments'), undefined, a.trainer.token)).data.comments.some(c => c.comment === text)).toBe(true);
    await expect(restored.locator('..').getByRole('button', {name: 'Guardar comentario remoto', exact: true})).toBeDisabled();
    await page.reload(); await page.getByRole('heading', {name: 'Tu repertorio'}).waitFor();
    await page.getByRole('button', {name: 'Entrenador', exact: true}).click();
    await page.getByRole('button', {name: 'Equipo', exact: true}).click(); await select(page, u);
    await page.locator('.student-detail details.repertoire-position').first().locator('summary').click();
    await expect(page.getByLabel('Comentario', {exact: true}).first()).toHaveValue(text);
    await expect(page.getByText('Borrador de comentario conservado en este dispositivo.', {exact: false})).toHaveCount(0);
  } finally {await a.close();}
});

test('SYN08: text typed during comment save is retained and requires another explicit save', async ({page}, info) => {
  const a = await createLocalAcademy(); let release = () => {};
  try {
    const u = await a.register('syn08-inflight'); await team(page, a); await select(page, u);
    await page.locator('.student-detail details.repertoire-position').first().locator('summary').click();
    const box = page.getByLabel('Comentario', {exact: true}).first(), save = box.locator('..').getByRole('button', {name: 'Guardar comentario remoto', exact: true});
    const first = 'SYN08 first explicit version', second = 'SYN08 typed during request';
    await box.fill(first);
    let entered; const gate = new Promise(r => release = r), seen = new Promise(r => entered = r);
    await page.route('**/api/v2/commands/comments', async route => {entered(); await gate; await route.continue();}, {times: 1});
    const ack = page.waitForResponse(r => r.url().endsWith('/commands/comments')); await save.click(); await seen;
    await box.fill(second); release(); expect((await ack).status()).toBe(200);
    await expect(save).toBeEnabled(); await expect(box).toHaveValue(second);
    let source = await a.call(userPath(u, 'comments'), undefined, a.trainer.token);
    expect(source.data.comments.some(c => c.comment === first)).toBe(true);
    expect(source.data.comments.some(c => c.comment === second)).toBe(false);
    await page.reload(); await page.getByRole('heading', {name: 'Tu repertorio'}).waitFor();
    await page.getByRole('button', {name: 'Entrenador', exact: true}).click();
    await page.getByRole('button', {name: 'Equipo', exact: true}).click(); await select(page, u);
    await page.locator('.student-detail details.repertoire-position').first().locator('summary').click();
    const restored = page.getByLabel('Comentario', {exact: true}).first(); await expect(restored).toHaveValue(second);
    const finalAck = page.waitForResponse(r => r.url().endsWith('/commands/comments'));
    await restored.locator('..').getByRole('button', {name: 'Guardar comentario remoto', exact: true}).click();
    expect((await finalAck).status()).toBe(200);
    source = await a.call(userPath(u, 'comments'), undefined, a.trainer.token);
    expect(source.data.comments.some(c => c.comment === second)).toBe(true);
    await evidence(info, 'comment-generation-ack', {firstRequiresExplicitSave: true, newerTextSurvivedReload: true, secondRequiresExplicitSave: true});
  } finally {release(); await a.close();}
});

test('SYN08: IndexedDB comment draft failure is visible and explicit retry preserves text', async ({page}) => {
  const a = await createLocalAcademy();
  try {
    const u = await a.register('syn08-idb-failure'); await team(page, a); await select(page, u);
    await page.locator('.student-detail details.repertoire-position').first().locator('summary').click();
    await page.evaluate(() => {
      const original = IDBObjectStore.prototype.put;
      window.__qaRestoreDraftPut = () => {IDBObjectStore.prototype.put = original;};
      IDBObjectStore.prototype.put = function (...args) {
        if (this.name === 'drafts') throw new DOMException('Synthetic local quota failure', 'QuotaExceededError');
        return original.apply(this, args);
      };
    });
    const box = page.getByLabel('Comentario', {exact: true}).first(), text = 'SYN08 local failure text';
    await box.fill(text);
    await expect(box.locator('..').getByRole('alert')).toContainText('No se pudo conservar el borrador');
    await expect(box).toHaveValue(text);
    await expect(box.locator('..')).not.toContainText('Borrador de comentario conservado en este dispositivo.');
    expect((await a.call(userPath(u, 'comments'), undefined, a.trainer.token)).data.comments.some(c => c.comment === text)).toBe(false);
    await page.evaluate(() => {window.__qaRestoreDraftPut(); delete window.__qaRestoreDraftPut;});
    const saved = page.waitForResponse(r => r.url().endsWith('/commands/comments'));
    await box.locator('..').getByRole('button', {name: 'Guardar comentario remoto', exact: true}).click();
    expect((await saved).status()).toBe(200);
    await expect(box.locator('..').getByRole('alert')).toHaveCount(0);
    expect((await a.call(userPath(u, 'comments'), undefined, a.trainer.token)).data.comments.some(c => c.comment === text)).toBe(true);
  } finally {await a.close();}
});

test('SYN06 ISO02: two tabs retain independent failed drafts for the same account after reload', async ({page, context}, info) => {
  const a = await createLocalAcademy(); let second;
  try {
    const u = await a.register('syn06-two-tabs');
    await a.login(page, u.profile.mail);
    second = await context.newPage();
    await second.goto(a.origin);
    await second.getByRole('heading', {name: 'Tu repertorio'}).waitFor();
    const tabs = [page, second], texts = ['SYN06 private draft from first tab', 'SYN06 private draft from second tab'];
    const before = await a.call(userPath(u), undefined, u.token);
    for (let index = 0; index < tabs.length; index++) {
      const tab = tabs[index];
      await tab.route('**/api/v2/commands/repertoire', route => route.fulfill({status: 500, contentType: 'application/json', body: '{"error":"QA_TWO_TAB_FAILURE"}'}));
      await (await editor(tab)).fill(texts[index]);
      await tab.getByRole('button', {name: 'Reintentar guardado', exact: true}).waitFor();
    }
    const editorIds = await Promise.all(tabs.map(tab => tab.evaluate(() => sessionStorage.getItem('pgt-draft-editor'))));
    expect(editorIds.every(Boolean)).toBe(true); expect(new Set(editorIds).size).toBe(2);
    const journalRows = () => page.evaluate(async mail => {
      const db = await new Promise((resolve, reject) => {const r = indexedDB.open('pgt-active-user-v1'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);});
      try {return await new Promise((resolve, reject) => {const r = db.transaction('drafts').objectStore('drafts').getAll(); r.onsuccess = () => resolve(r.result.filter(draft => draft.actor === mail && draft.owner === mail && draft.resource === 'techniques')); r.onerror = () => reject(r.error);});}
      finally {db.close();}
    }, u.profile.mail);
    await expect.poll(async () => (await journalRows()).length).toBe(2);
    const rows = await journalRows();
    expect(rows.map(row => row.editor).sort()).toEqual([...editorIds].sort());
    expect(rows.map(row => row.data.positions[0].tecnicas[0].descripcion_del_alumno).sort()).toEqual([...texts].sort());
    let automaticWrites = 0;
    for (const tab of tabs) {
      await tab.unroute('**/api/v2/commands/repertoire');
      tab.on('request', req => {if(req.url().includes('/commands/')) automaticWrites++;});
    }
    for (let index = 0; index < tabs.length; index++) {
      const tab = tabs[index]; await tab.reload();
      await tab.getByRole('heading', {name: 'Tu repertorio'}).waitFor();
      await expect(await editor(tab)).toHaveValue(texts[index]);
      await expect(tab.getByRole('button', {name: 'Reintentar guardado', exact: true})).toBeVisible();
      expect(await tab.evaluate(() => sessionStorage.getItem('pgt-draft-editor'))).toBe(editorIds[index]);
    }
    expect(automaticWrites).toBe(0);
    expect((await a.call(userPath(u), undefined, u.token)).data).toEqual(before.data);
    expect(await journalRows()).toEqual(rows);
    await evidence(info, 'two-tab-draft-isolation', {sharedAccount: true, editorIds, draftRows: rows.length, independentTexts: texts, automaticWrites, remoteUnchanged: true});
  } finally {await second?.close(); await a.close();}
});

test('ISO08: denied private pupil view is removed from a second tab that already displays it', async ({page, context}, info) => {
  const a = await createLocalAcademy(); let second;
  try {
    const u = await a.register('iso08-displayed-private');
    await team(page, a); await select(page, u);
    second = await context.newPage(); await second.goto(a.origin);
    await second.getByRole('heading', {name: 'Tu repertorio'}).waitFor();
    await second.getByRole('button', {name: 'Entrenador', exact: true}).click();
    await second.getByRole('button', {name: 'Equipo', exact: true}).click(); await select(second, u);
    await expect(second.locator('.student-detail .repertoire-progress')).toBeVisible();
    await expect(second.getByRole('status', {name: 'Actualizando ficha', exact: true})).toHaveCount(0);
    const secondPrivateRequests = [];
    second.on('request', req => {if(req.url().includes('/users/' + encodeURIComponent(u.profile.mail) + '/')) secondPrivateRequests.push(new URL(req.url()).pathname);});
    await page.route('**/api/v2/users/' + encodeURIComponent(u.profile.mail) + '/profile', route => route.fulfill({status: 403, contentType: 'application/json', body: '{"error":"QA_PERMISSION_REVOKED"}'}));
    const denied = page.waitForResponse(r => r.url().endsWith('/profile') && r.status() === 403);
    await page.locator('.student-card').filter({hasText: u.profile.nombre + ' ' + u.profile.apellidos}).click();
    await denied;
    await expect(page.locator('.student-detail')).toHaveCount(0);
    await evidence(info, 'cross-tab-private-view-denied', {firstTabDetailCount: await page.locator('.student-detail').count(), secondTabBody: await second.locator('body').innerText()});
    await expect(second.locator('.student-detail')).toHaveCount(0);
    await context.setOffline(true);
    await expect(second.locator('.student-detail')).toHaveCount(0);
    await expect(second.locator('.student-card[aria-pressed=true]')).toHaveCount(0);
    expect(secondPrivateRequests).toEqual([]);
    await evidence(info, 'cross-tab-private-view-cleared', {secondPrivateRequests, detailRemovedOffline: true, selectionCleared: true});
  } finally {await context.setOffline(false); await second?.close(); await a.close();}
});

test('SYN06: a new tab explicitly recovers a failed draft left by a closed tab', async ({context}, info) => {
  const a = await createLocalAcademy(); let first, replacement;
  try {
    const u = await a.register('syn06-closed-tab'), text = 'SYN06 synthetic draft from a closed tab';
    first = await context.newPage(); await a.login(first, u.profile.mail);
    await first.route('**/api/v2/commands/repertoire', route => route.fulfill({status: 500, contentType: 'application/json', body: '{"error":"QA_CLOSED_TAB_FAILURE"}'}));
    await (await editor(first)).fill(text);
    await first.getByRole('button', {name: 'Reintentar guardado', exact: true}).waitFor();
    const originalEditor = await first.evaluate(() => sessionStorage.getItem('pgt-draft-editor'));
    const before = await a.call(userPath(u), undefined, u.token);
    await first.close();
    replacement = await context.newPage(); let automaticWrites = 0;
    replacement.on('request', req => {if(req.url().includes('/commands/')) automaticWrites++;});
    await replacement.goto(a.origin); await replacement.getByRole('heading', {name: 'Tu repertorio'}).waitFor();
    const replacementEditor = await replacement.evaluate(() => sessionStorage.getItem('pgt-draft-editor'));
    expect(replacementEditor).not.toBe(originalEditor);
    await expect(await editor(replacement)).not.toHaveValue(text);
    await replacement.getByRole('button', {name: 'Perfil', exact: true}).click();
    await evidence(info, 'closed-tab-draft-before-recovery', {originalEditor, replacementEditor, body: await replacement.locator('body').innerText(), automaticWrites});
    const recover = replacement.getByRole('button', {name: 'Recuperar borrador de técnicas', exact: true});
    await recover.scrollIntoViewIfNeeded();
    await replacement.screenshot({path: info.outputPath('profile-draft-desktop.png')});
    await replacement.setViewportSize({width: 390, height: 844}); await recover.scrollIntoViewIfNeeded();
    expect(await replacement.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await replacement.screenshot({path: info.outputPath('profile-draft-mobile.png')});
    await replacement.setViewportSize({width: 1440, height: 1000});
    await recover.click();
    await replacement.getByRole('button', {name: 'Mis técnicas', exact: true}).click();
    await expect(await editor(replacement)).toHaveValue(text);
    await expect(replacement.getByRole('button', {name: 'Reintentar guardado', exact: true})).toBeVisible();
    expect(automaticWrites).toBe(0);
    expect((await a.call(userPath(u), undefined, u.token)).data).toEqual(before.data);
    await replacement.getByRole('button', {name: 'Reintentar guardado', exact: true}).click();
    await replacement.locator('.sync-success').waitFor();
    expect((await a.call(userPath(u), undefined, u.token)).data.positions[0].tecnicas[0].descripcion_del_alumno).toBe(text);
    await replacement.getByRole('button', {name: 'Salir', exact: true}).click();
    await expect(replacement.getByRole('button', {name: 'Entrar', exact: true})).toBeVisible();
    await evidence(info, 'closed-tab-draft-recovered', {explicitRecovery: true, automaticWritesBeforeRetry: 0, explicitRetryConfirmed: true, logoutAllowed: true});
  } finally {if(first && !first.isClosed()) await first.close(); await replacement?.close(); await a.close();}
});

test('SYN08: comment stays in memory across pupil switches when IndexedDB draft writes fail', async ({page}, info) => {
  const a = await createLocalAcademy();
  try {
    const u = await a.register('syn08-quota-a'), v = await a.register('syn08-quota-b');
    await team(page, a); await select(page, u);
    await page.locator('.student-detail details.repertoire-position').first().locator('summary').click();
    let commentWrites = 0;
    page.on('request', req => {if(req.url().endsWith('/commands/comments')) commentWrites++;});
    await page.evaluate(() => {
      const original = IDBObjectStore.prototype.put;
      window.__qaRestoreDraftPut = () => {IDBObjectStore.prototype.put = original;};
      IDBObjectStore.prototype.put = function (...args) {
        if (this.name === 'drafts') throw new DOMException('Synthetic navigation quota failure', 'QuotaExceededError');
        return original.apply(this, args);
      };
    });
    const text = 'SYN08 volatile comment survives selection';
    await page.getByLabel('Comentario', {exact: true}).first().fill(text);
    await expect(page.locator('[role=alert]').filter({hasText: /No se pudo conservar el borrador/}).first()).toBeVisible();
    await select(page, v); await select(page, u);
    await page.locator('.student-detail details.repertoire-position').first().locator('summary').click();
    await evidence(info, 'volatile-comment-before-assertion', {commentWrites, body: await page.locator('body').innerText()});
    await expect(page.getByLabel('Comentario', {exact: true}).first()).toHaveValue(text);
    await expect(page.locator('[role=alert]').filter({hasText: /borrador|copia local|dispositivo/i}).first()).toBeVisible();
    await expect(page.getByLabel('Comentario', {exact: true}).first().locator('..')).not.toContainText('Borrador de comentario conservado en este dispositivo.');
    expect(commentWrites).toBe(0);
    expect((await a.call(userPath(u, 'comments'), undefined, a.trainer.token)).data.comments.some(c => c.comment === text)).toBe(false);
    let dialogType, mainFrameNavigations = 0, reloadError;
    page.on('framenavigated', frame => {if(frame === page.mainFrame()) mainFrameNavigations++;});
    page.once('dialog', async dialog => {dialogType = dialog.type(); await dialog.dismiss();});
    try {await page.reload({timeout: 5000});} catch (error) {reloadError = error.message;}
    expect(dialogType).toBe('beforeunload');
    expect(mainFrameNavigations).toBe(0);
    await expect(page.getByLabel('Comentario', {exact: true}).first()).toHaveValue(text);
    expect(commentWrites).toBe(0);
    await evidence(info, 'volatile-draft-beforeunload-dismissed', {dialogType, mainFrameNavigations, reloadError, textRetained: true, automaticWrites: commentWrites});
    await page.evaluate(() => {window.__qaRestoreDraftPut(); delete window.__qaRestoreDraftPut;});
  } finally {await a.close();}
});

test('OFF04: trainer comments stay read only offline and send no commands', async ({page, context}, info) => {
  const a = await createLocalAcademy();
  try {
    const u = await a.register('off04-comment'), techniques = await a.call(userPath(u), undefined, u.token);
    const notes = await a.call(userPath(u, 'comments'), undefined, a.trainer.token), text = 'OFF04 confirmed server comment';
    await a.call('commands/comments', operation({...notes.data, comments: [{techniqueId: techniques.data.positions[0].tecnicas[0].id, comment: text}]}, notes.version, {owner: u.profile.mail}), a.trainer.token);
    await team(page, a); await select(page, u);
    await page.locator('.student-detail details.repertoire-position').first().locator('summary').click();
    const box = page.getByLabel('Comentario', {exact: true}).first(); await expect(box).toHaveValue(text);
    let commands = 0; page.on('request', req => {if(req.url().includes('/commands/')) commands++;});
    await context.setOffline(true);
    await box.press('End'); await box.press('X');
    await expect(box).toHaveValue(text);
    await expect(box).toHaveAttribute('readonly', '');
    await expect(box.locator('..').getByRole('button', {name: 'Guardar comentario remoto', exact: true})).toBeDisabled();
    expect(commands).toBe(0);
    expect((await a.call(userPath(u, 'comments'), undefined, a.trainer.token)).data.comments[0].comment).toBe(text);
    await evidence(info, 'offline-comment-readonly', {commands, confirmedTextUnchanged: true});
  } finally {await context.setOffline(false); await a.close();}
});
