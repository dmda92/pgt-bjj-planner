import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { caseTest, expect } from '../helpers/case-test.mjs';

const devUrl = 'https://pgt-github-probe-dev.david-dzm5.workers.dev';
const workflowPath = '.github/workflows/cloudflare-dev.yml';
const configPath = 'wrangler.dev.jsonc';
const sha256 = value => createHash('sha256').update(value).digest('hex');
const options = {
  users: ['auditoría sin sesión'],
  environment: 'Inspección actual del código y Chromium DEV real anónimo; sin despliegue ni escrituras externas',
  adaptation: 'La promoción se interpreta exclusivamente para develop y Worker DEV. GitHub solo se usa como código y CI/CD; Firestore es la persistencia de negocio.'
};

async function inspectRuntime(browser, r) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const response = await page.goto(`${devUrl}/api/dev/runtime`, { waitUntil: 'domcontentloaded' });
    expect(response.status()).toBe(200);
    const runtime = await response.json();
    expect(runtime.project).toBe('pgt-bjj-dev');
    expect(runtime.revision).toBe('firestore-v2-20261026');
    expect(runtime.build).toMatch(/^[0-9a-f]{40}$/);
    expect(runtime.domainBuild).toBe(runtime.build);
    expect(response.headers()['x-pgt-worker-build']).toBe(runtime.build);
    const develop = execFileSync('git', ['rev-parse', 'origin/develop'], { encoding: 'utf8' }).trim();
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    await r.json('current-runtime', { url: devUrl, status: response.status(), runtime, originDevelop: develop, localHead: head,
      matchesOriginDevelop: runtime.build === develop, noAuthentication: true, operations: ['GET /api/dev/runtime'] });
    await r.capture(page, 'runtime-dev');
    return { runtime, develop };
  } finally { await context.close(); }
}

function inspectFiles() {
  const workflow = readFileSync(workflowPath, 'utf8');
  const configSource = readFileSync(configPath, 'utf8');
  return { workflow, config: JSON.parse(configSource), hashes: { [workflowPath]: sha256(workflow), [configPath]: sha256(configSource) } };
}

caseTest('DEP 02', options, async ({ browser }, r) => {
  let files;
  await r.step('Leer los gates y dependencias del workflow DEV actual, sin ejecutarlo ni alterarlo', async () => {
    files = inspectFiles();
    const deployment = files.workflow.slice(files.workflow.indexOf('\n  deploy-dev:'));
    expect(deployment).toContain('needs: [ validate, validate-online ]');
    expect(deployment).toContain("github.ref == 'refs/heads/develop'");
    expect(deployment).toContain("vars.DEV_DEPLOY_ENABLED == 'true'");
    expect(deployment).toContain('environment: development');
    expect(files.workflow).not.toMatch(/continue-on-error:\s*true/);
    expect(deployment.split('steps:')[0]).not.toContain('always()');
    for (const gate of ['npm test', 'npm run typecheck', 'npm run build', 'npm run check:worker', 'npm run test:runtime', 'npm run test:browser'])
      expect(files.workflow).toContain(gate);
    await r.json('gate-source', { path: workflowPath, sha256: files.hashes[workflowPath],
      needs: ['validate', 'validate-online'], deployOnlyDevelop: true, continueOnError: false, source: files.workflow });
  });
  await r.step('Observar el runtime DEV servido durante esta campaña sin autenticación', async () => { await inspectRuntime(browser, r); });
  r.finish('PARCIAL', 'El workflow actual exige ambos trabajos de validación sin continue-on-error y restringe deploy a develop habilitado. Runtime DEV observado sin escritura.',
    'No se ha provocado un fallo nuevo en GitHub Actions ni publicado un commit de fallo. La campaña prohíbe desplegar y alterar mecanismos de producción; esta inspección no demuestra por sí sola el bloqueo efectivo de un run fallido de Actions.');
});

caseTest('DEP 03', options, async ({ browser }, r) => {
  await r.step('Inspeccionar serialización, rechazo de HEAD obsoleto y verificación del Worker/coordinador', async () => {
    const { workflow, hashes } = inspectFiles();
    expect(workflow).toContain('group: pgt-worker-dev-deployment');
    expect(workflow).toContain('cancel-in-progress: false');
    expect(workflow).toContain('/git/ref/heads/develop');
    expect(workflow).toContain('object.sha !== process.env.GITHUB_SHA');
    expect(workflow).toContain('Skipping obsolete commit.');
    expect(workflow).toContain('DEV_RUNTIME_BUILD_VERIFIED');
    expect(workflow).toContain('value.domainBuild===expectedBuild');
    expect(workflow).toContain('deployedBuild===process.env.GITHUB_SHA');
    await r.json('serialization-source', { sha256: hashes[workflowPath], source: workflow,
      configuredBehavior: ['DEV deployment serialization', 'reject obsolete develop HEAD', 'verify existing SHA without republishing', 'verify Worker and coordinator exact served SHA'] });
  });
  await r.step('Contrastar la revisión DEV servida con origin/develop disponible localmente', async () => {
    const { runtime, develop } = await inspectRuntime(browser, r);
    expect(runtime.build).toBe(develop);
  });
  r.finish('PARCIAL', 'La configuración serializa las publicaciones DEV, comprueba el HEAD y el runtime real coincide con origin/develop en Worker y coordinador.',
    'No se enviaron dos versiones ni se ejecutó Deploy: el encargo prohíbe despliegues durante QA. No se han verificado en esta campaña dos ejecuciones concurrentes de Actions ni la ausencia efectiva de duplicados de Workers Builds. Main/PRO no se tocaron.');
});

caseTest('DEP 04', options, async ({ browser }, r) => {
  await r.step('Revisar que el manifiesto DEV conserva bindings y no contiene valores de credenciales', async () => {
    const { workflow, config, hashes } = inspectFiles();
    expect(config.name).toBe('pgt-github-probe-dev');
    expect(config.main).toBe('worker/dev.ts');
    expect(config.vars.FIRESTORE_PROJECT_ID).toBe('pgt-bjj-dev');
    expect(config.durable_objects.bindings.map(x => x.name)).toEqual(['SECURITY', 'DOMAIN_IO']);
    expect(Object.keys(config.vars).sort()).toEqual(['ALLOWED_ORIGINS', 'FIRESTORE_DATABASE_ID', 'FIRESTORE_PROJECT_ID']);
    expect(workflow).toContain('${{ secrets.CLOUDFLARE_API_TOKEN }}');
    expect(workflow).toContain('${{ secrets.CLOUDFLARE_ACCOUNT_ID }}');
    expect(workflow).toContain('DEV_RUNTIME_VERIFIED_NO_FIRESTORE_TESTS');
    expect(workflow).toContain('No preflight CRUD, inventory, bootstrap, cleanup');
    await r.json('configuration-audit', { hashes, worker: config.name, entrypoint: config.main,
      project: config.vars.FIRESTORE_PROJECT_ID, bindings: config.durable_objects.bindings,
      migrationTags: config.migrations.map(x => x.tag), credentialValuesInManifest: false,
      workflowSecretsReferencesOnly: ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'], sourceConfig: config });
  });
  await r.step('Observar DEV actual sin reinicializar datos o sesiones', async () => { await inspectRuntime(browser, r); });
  r.finish('PARCIAL', 'Configuración DEV y referencias de secrets comprobadas; bindings SECURITY/DOMAIN_IO y proyecto DEV identificados. La verificación del despliegue configurada no ejecuta CRUD ni limpieza de Firestore.',
    'No se realizó deploy ni se consultaron valores de secretos del proveedor. Falta comparación real antes/después de un despliegue de secretos, bindings y datos; no se afirma conservación demostrada por una publicación que no se ha ejecutado.');
});
