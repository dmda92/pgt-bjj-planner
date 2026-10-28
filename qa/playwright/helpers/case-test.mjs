import { test, expect } from '@playwright/test';
import { readFileSync, existsSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
export { expect };
export const campaign = resolve(process.env.QA_CAMPAIGN_DIR || '.qa/campaigns/2026-10-26');
export const manifest = JSON.parse(readFileSync(resolve(campaign, 'manifest.json'), 'utf8'));
const safeId = id => id.replaceAll(' ', '-');
export function caseTest(id, options, action) {
    if (typeof options === 'function') { action = options; options = {}; }
    const item = manifest.cases.find(c => c.id === id);
    // Adapters for older protocols may coexist. Unknown manifest cases remain
    // NO EJECUTADO and the closing audit refuses to certify missing coverage.
    if (!item) return;
    const selected = process.env.QA_CASES?.split(',');
    if (selected && !selected.includes(id)) return;
    if (process.env.QA_BLOCK && item.id.split(' ')[0] !== process.env.QA_BLOCK) return;
    const output = resolve(campaign, 'results', safeId(id) + '.json');
    const old = existsSync(output) ? JSON.parse(readFileSync(output, 'utf8')) : null;
    if (process.env.QA_PENDING === '1' && old && old.status !== 'NO EJECUTADO') return;
    if (process.env.QA_FAILED === '1' && !['FALLIDO', 'PARCIAL', 'BLOQUEADO'].includes(old?.status)) return;
    test(`${id} ${item.title}`, async ({ browser, playwright }, info) => {
        const dir = resolve(campaign, 'evidence', safeId(id), new Date().toISOString().replace(/[:.]/g, '-')); mkdirSync(dir, { recursive: true });
        const result = { id, status: 'PARCIAL', executedAt: new Date().toISOString(), environment: options.environment || 'DEV real',
            users: options.users || ({ PRO: ['A', 'A2'], TEC: ['A', 'A2', 'B'], COM: ['T', 'A', 'A2', 'B', 'C'] }[item.id.split(' ')[0]] || []), steps: [], observed: '', expected: item.expected, evidence: [], adaptation: options.adaptation || '' };
        const record = {
            result, dir,
            previous: () => old,
            includePrevious: () => {
                if (!old) return;
                result.steps.push(...(old.steps || [])); result.evidence.push(...(old.evidence || []));
                result.users = [...new Set([...result.users, ...(old.users || [])])];
            },
            step: async (name, fn) => { const value = await test.step(name, fn); result.steps.push(name); return value; },
            finish: (status, observed, limitation = '') => Object.assign(result, { status, observed, limitation }),
            capture: async (page, name = 'screenshot') => {
                const path = resolve(dir, `${name}.png`); await page.screenshot({ path, fullPage: false, mask: [page.locator('input[type=password],input[name=password],input[name=confirm]')] });
                result.evidence.push(path); await info.attach(name, { path, contentType: 'image/png' });
            },
            json: async (name, value) => { const path = resolve(dir, name + '.json'); writeFileSync(path, JSON.stringify(value, null, 2)); result.evidence.push(path); }
        };
        try { await action({ browser, playwright, info }, record); }
        catch (error) {
            result.status = 'FALLIDO'; result.observed = String(error.message).replace(/\u001b\[[0-9;]*m/g, '').slice(0, 6000); result.incident = `${safeId(id)}-01`;
            for (const [role, page] of Object.entries(globalThis.__qaWorld?.pages || {})) {
                try { await record.capture(page, 'failure-' + role); await record.json('body-' + role, { text: await page.locator('body').innerText() }); } catch {}
            }
            await record.json('failure-' + Date.now(), { observed: result.observed, executed: result.steps, expected: item.expected }); throw error;
        }
        finally {
            mkdirSync(resolve(campaign, 'results'), { recursive: true });
            if (existsSync(output)) { mkdirSync(resolve(campaign, 'attempts'), { recursive: true }); copyFileSync(output, resolve(campaign, 'attempts', safeId(id) + '-' + Date.now() + '.json')); }
            writeFileSync(output, JSON.stringify(result, null, 2));
            await info.attach('resultado', { body: Buffer.from(JSON.stringify(result, null, 2)), contentType: 'application/json' });
        }
    });
}
