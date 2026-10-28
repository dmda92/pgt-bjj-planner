import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
const campaign = resolve(process.env.QA_CAMPAIGN_DIR || '.qa/campaigns/2026-10-26');
const suffix = process.env.QA_REPORT_SUFFIX || 'current';
export default defineConfig({
    testDir: './tests', timeout: 180000, expect: { timeout: 15000 }, retries: 0,
    workers: 1, fullyParallel: false,
    outputDir: resolve(campaign, `playwright-output-${suffix}`),
    reporter: [['list'], ['html', { outputFolder: resolve(campaign, `playwright-report-${suffix}`), open: 'never' }], ['json', { outputFile: resolve(campaign, `playwright-results-${suffix}.json`) }], ['blob', { outputDir: resolve(campaign, 'blob-reports'), fileName: `report-${suffix}-${Date.now()}.zip` }]],
    use: { browserName: 'chromium', headless: true, trace: 'off', screenshot: 'off', actionTimeout: 15000, viewport: { width: 1440, height: 1000 }, acceptDownloads: true }
});
