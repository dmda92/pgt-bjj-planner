// Content QA fallback only. This does not render or verify Word pagination.
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw Error('Usage: node qa/tools/render_report_html.mjs <case-results.html> <output-directory>');
await mkdir(resolve(output), { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(resolve(input)).href);
  const errors = [];
  const sections = page.locator('section[id]');
  const count = await sections.count();
  for (let index = 0; index < count; index++) {
    const section = sections.nth(index);
    const id = await section.getAttribute('id');
    const rect = await section.boundingBox();
    const overflow = await section.evaluate(node => node.scrollWidth > node.clientWidth + 1);
    if (!rect || rect.height < 100 || overflow) errors.push({ id, reason: 'Missing, undersized or horizontal overflow', rect, overflow });
    await section.screenshot({ path: join(resolve(output), `${id}.png`), animations: 'disabled' });
  }
  await writeFile(join(resolve(output), 'content-render-audit.json'), JSON.stringify({
    count, errors, browser: browser.version(), source: resolve(input),
    scope: 'HTML content screenshots and DOM overflow checks; no DOCX/Word pagination or visual fidelity assertion.'
  }, null, 2));
  console.log(JSON.stringify({ renderedCases: count, layoutErrors: errors.length, scope: 'HTML content only' }));
  if (errors.length) process.exitCode = 1;
} finally {
  await browser.close();
}
