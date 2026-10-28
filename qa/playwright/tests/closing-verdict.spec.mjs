import { test } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { caseTest, campaign, manifest } from '../helpers/case-test.mjs';

let executed = false;
const statuses = ['APROBADO', 'FALLIDO', 'PARCIAL', 'BLOQUEADO', 'NO APLICA', 'NO EJECUTADO'];
const key = id => id.replaceAll(' ', '-');

caseTest('FIN 04', {
  users: ['auditoría QA sin sesión'],
  environment: 'Auditoría local de resultados y evidencias de la campaña; sin operaciones externas',
  adaptation: 'Se evalúan resultados DEV y simulados por separado. APROBADO en esta ficha significa cierre QA correcto, nunca aceptación automática de la aplicación.'
}, async ({}, r) => {
  executed = true;
  const rows = [], invalid = [], missing = [], absentEvidence = [];
  await r.step('Auditar individualmente los resultados de todos los demás casos del manifiesto', async () => {
    for (const item of manifest.cases.filter(value => value.id !== 'FIN 04')) {
      const file = resolve(campaign, 'results', key(item.id) + '.json');
      if (!existsSync(file)) { missing.push(item.id); continue; }
      const result = JSON.parse(readFileSync(file, 'utf8'));
      if (result.id !== item.id || !statuses.includes(result.status)) invalid.push(item.id);
      if (result.status === 'APROBADO' && (!result.observed || !result.steps?.length || !result.evidence?.length)) invalid.push(item.id);
      for (const reference of result.evidence || []) {
        if (/^https?:\/\//.test(reference)) continue;
        if (!existsSync(resolve(campaign, reference))) absentEvidence.push({ id: item.id, reference });
      }
      rows.push({ id: item.id, title: item.title, priority: item.priority, ...result });
    }
  });
  if (missing.length || invalid.length || absentEvidence.length) {
    await r.json('closing-records-incomplete', { missing, invalid, absentEvidence, total: manifest.cases.length });
    r.finish('BLOQUEADO', 'No puede cerrarse la campaña: faltan resultados válidos o referencias de evidencia accesibles.',
      'Completar únicamente los identificadores y referencias enumerados en la auditoría; no convertirlos automáticamente en aprobados.');
    return;
  }
  await r.step('Contar estados por bloque, separar aprobación de ejecución y emitir dictamen conservador', async () => {
    const counts = Object.fromEntries(statuses.map(status => [status, 0]));
    const blocks = {}, environments = {};
    for (const row of rows) {
      counts[row.status]++;
      const block = row.id.split(' ')[0];
      (blocks[block] ||= Object.fromEntries(statuses.map(status => [status, 0])))[row.status]++;
      const environment = row.environment || 'Sin entorno registrado';
      (environments[environment] ||= Object.fromEntries(statuses.map(status => [status, 0])))[row.status]++;
    }
    // Include this successfully performed audit, without counting it as app acceptance.
    counts.APROBADO++;
    (blocks.FIN ||= Object.fromEntries(statuses.map(status => [status, 0]))).APROBADO++;
    const complete = counts.APROBADO + counts.FALLIDO;
    const unresolved = rows.filter(row => /^(crítica|critica|alta)\b/i.test(row.priority) && !['APROBADO', 'NO APLICA'].includes(row.status));
    const excluded = rows.filter(row => row.status === 'NO APLICA').map(row => ({ id: row.id, reason: row.limitation || row.adaptation }));
    const supplementPath = resolve(campaign, 'supplemental-incidents.json');
    const supplemental = existsSync(supplementPath) ? JSON.parse(readFileSync(supplementPath, 'utf8')) : [];
    const supplementalHigh = supplemental.filter(row => /^(ALTA|CRÍTICA|CRITICA)$/.test(row.severity));
    const hasOpenCoverage = rows.some(row => ['PARCIAL', 'BLOQUEADO', 'NO EJECUTADO'].includes(row.status));
    const reject = !!counts.FALLIDO || unresolved.length > 0 || supplementalHigh.length > 0 || hasOpenCoverage;
    const audit = {
      generatedAt: new Date().toISOString(), total: manifest.cases.length, counts, blocks, environments,
      fullyExecuted: complete, fullyExecutedPercent: +(100 * complete / manifest.cases.length).toFixed(2),
      approvalOfFullyExecutedPercent: complete ? +(100 * counts.APROBADO / complete).toFixed(2) : null,
      unresolvedCriticalOrHigh: unresolved.map(row => ({ id: row.id, status: row.status, limitation: row.limitation })),
      scopeExclusions: excluded, supplementalOutsideCaseCount: supplemental.map(row => ({ id: row.id, severity: row.severity })),
      verdict: reject ? 'RECHAZAR ACEPTACIÓN' : 'REVISAR EXCEPCIONES ANTES DE ACEPTAR',
      platformsNotVerified: ['Safari iOS físico', 'Android físico', 'Instalación PWA real en un dispositivo móvil'],
      limitations: 'Los entornos locales/simulados no acreditan Google remoto. Las exclusiones requieren su justificación y no suman a APROBADO. No se ha autorizado aceptación con incidencias abiertas.'
    };
    await r.json('closing-audit', audit);
    r.finish('APROBADO', `Cierre QA auditado sobre ${manifest.cases.length} casos. ${audit.verdict}: ${counts.FALLIDO} casos fallidos, ${unresolved.length} criterios críticos/altos sin aprobación completa y ${supplementalHigh.length} incidencias suplementarias altas/críticas. Ejecución completa ${audit.fullyExecutedPercent}% y aprobación sobre ejecución completa ${audit.approvalOfFullyExecutedPercent}%.`,
      'Este APROBADO acredita el recuento, la trazabilidad y el dictamen conservador; la versión no queda aceptada. Las plataformas físicas y la integración remota solo se acreditan donde existe evidencia específica.');
  });
});

test.afterAll(async () => {
  if (!executed) return;
  const python = process.env.QA_PYTHON || 'python';
  const commands = [
    ['qa/tools/campaign_report.py', '--campaign', campaign],
    ['qa/tools/protocol_docx.py', 'fill', '--manifest', resolve(campaign, 'manifest.json'), '--results', resolve(campaign, 'results'), '--output', resolve(campaign, 'reports', 'resultados.docx')]
  ];
  for (const args of commands) {
    const child = spawnSync(python, args, { encoding: 'utf8', stdio: 'inherit', env: { ...process.env, PYTHONUTF8: '1' } });
    if (child.error) throw child.error;
    if (child.status !== 0) throw Error('QA report generation failed: ' + args[0]);
  }
});
