import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const args = process.argv.slice(2), command = args.shift() || 'run';
const option = name => { const index = args.indexOf('--' + name); return index < 0 ? undefined : args[index + 1]; };
const id = option('campaign') || '2026-10-26';
if (!/^[A-Za-z0-9._-]+$/.test(id)) throw Error('Invalid campaign id');
const root = resolve('.qa/campaigns', id), env = { ...process.env, QA_CAMPAIGN_DIR: root };
delete env.NO_COLOR; env.FORCE_COLOR = '0';
const execute = (binary, argv) => { const child = spawnSync(binary, argv, { stdio: 'inherit', env }); if (child.error) throw child.error; if (child.status) process.exit(child.status); };
if (command === 'new') {
    if (!option('document')) throw Error('new requires --document');
    if (existsSync(resolve(root, 'manifest.json'))) throw Error('Campaign already exists; choose new identifier to avoid resetting results');
    mkdirSync(root, { recursive: true });
    execute('python', ['qa/tools/protocol_docx.py', 'extract', '--source', resolve(option('document')), '--campaign', id, '--output', resolve(root, 'manifest.json')]);
} else if (command === 'run') {
    if (!existsSync(resolve(root, 'manifest.json'))) throw Error('Initialize campaign with new --document');
    if (option('block')) env.QA_BLOCK = option('block');
    if (option('case')) env.QA_CASES = option('case');
    if (args.includes('--pending')) env.QA_PENDING = '1';
    if (args.includes('--failed')) env.QA_FAILED = '1';
    env.QA_REPORT_SUFFIX = option('report') || `${id}-${Date.now()}`;
    if (option('suite')) {
        execute(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '-c', 'qa/playwright/playwright.config.mjs', ...(option('suite') ? [option('suite')] : [])]);
    } else {
        // Lifecycle matters: register before editing, finish all scenarios before cleanup.
        // Continue after failed cases; evidence/reporting must include the entire campaign.
        const phases=['remote-setup','remote-profile-techniques','remote-competitions','remote-trainer','remote-performance','remote-pdf','plans','faults','remote-access','remote-security','fault-role-cycle','fault-block-reuse','local-pwa-update','local-motion-followup','remote-pwa','remote-criteria-followup','reference-template','local-text-safety','deployment-audit','campaign-close','closing-verdict'];
        let failure=false;
        if (!option('case') && !option('block') && !args.includes('--pending') && !args.includes('--failed')) {
            const gates=spawnSync(process.execPath,['qa/tools/run-gates.mjs'],{stdio:'inherit',env});if(gates.error)throw gates.error;failure ||= gates.status!==0;
        }
        const suffix=env.QA_REPORT_SUFFIX;
        for (const phase of phases) {
            if(phase==='fault-block-reuse'&&(option('case')||option('block')||args.includes('--pending')||args.includes('--failed')))continue;
            const child=spawnSync(process.execPath,['node_modules/@playwright/test/cli.js','test','-c','qa/playwright/playwright.config.mjs',`${phase}.spec.mjs`],{stdio:'inherit',env:{...env,QA_REPORT_SUFFIX:suffix+'-'+phase}});
            if(child.error)throw child.error;
            // Exit 1 with no selected cases in a pending/failed phase is harmless.
            const report=resolve(root,`playwright-results-${suffix+'-'+phase}.json`);
            let selected=true;if(existsSync(report)){const body=JSON.parse(readFileSync(report,'utf8'));selected=(body.stats?.expected||0)+(body.stats?.unexpected||0)+(body.stats?.skipped||0)>0;}
            failure ||= child.status!==0&&selected;
        }
        process.exitCode=failure?1:0;
    }
} else if (command === 'report') {
    execute('python', ['qa/tools/campaign_report.py', '--campaign', root]);
    execute('python', ['qa/tools/protocol_docx.py', 'fill', '--manifest', resolve(root, 'manifest.json'), '--results', resolve(root, 'results'), '--output', resolve(root, 'reports', 'resultados.docx')]);
} else if (command === 'status') {
    const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8')), counts = {};
    for (const item of manifest.cases) { const path = resolve(root, 'results', item.id.replaceAll(' ', '-') + '.json'); const status = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')).status : 'NO EJECUTADO'; counts[status] = (counts[status] || 0) + 1; }
    console.log(JSON.stringify({ campaign: id, total: manifest.caseCount, counts }, null, 2));
} else throw Error('Commands: new, run, status, report');
