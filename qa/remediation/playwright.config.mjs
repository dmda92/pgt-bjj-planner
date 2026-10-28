import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';
const output = resolve(process.env.QA_REMEDIATION_DIR || '.qa/remediation-2026-10-28', process.env.QA_REPORT_SUFFIX || 'current');
export default defineConfig({
  testDir: '.', testMatch: '*.spec.mjs', timeout: 120000, expect: {timeout: 10000},
  workers: 1, fullyParallel: false, retries: 0,
  outputDir: resolve(output, 'artifacts'),
  reporter: [['list'], ['json', {outputFile: resolve(output, 'results.json')}], ['html', {outputFolder: resolve(output, 'report'), open: 'never'}]],
  use: {browserName: 'chromium', headless: true, viewport: {width: 1440, height: 1000}, actionTimeout: 15000, screenshot: 'only-on-failure', trace: 'retain-on-failure'}
});
