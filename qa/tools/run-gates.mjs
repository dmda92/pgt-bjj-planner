import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root=resolve(process.env.QA_CAMPAIGN_DIR||'.qa/campaigns/2026-10-26'),dir=resolve(root,'evidence','DEP-01','gates-'+Date.now());mkdirSync(dir,{recursive:true});
const commands=['npm ci','npm test','npm run typecheck','npm run build','node scripts/check-structured-boundary.mjs','npm run check:worker','npm run test:runtime','npm run check:firestore-v2','npm run test:browser','npm run benchmark:firestore-v2','npm run test:performance','node scripts/check-dev-config.mjs','npx --no-install wrangler deploy --config wrangler.dev.jsonc --dry-run --outdir .worker-dev-build'];
const rows=[];
for(const command of commands){
    const at=new Date().toISOString(),start=Date.now(),x=spawnSync(process.env.ComSpec||'cmd.exe',['/d','/s','/c',command],{encoding:'utf8',maxBuffer:50*1024*1024,env:{...process.env,VITE_PERSISTENCE:'firestore-dev',VITE_API_BASE_URL:'',CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV:'false',WRANGLER_SEND_METRICS:'false'}});
    const path=resolve(dir,String(rows.length+1).padStart(2,'0')+'-'+command.replace(/[^a-zA-Z0-9]+/g,'-')+'.log');writeFileSync(path,(x.stdout||'')+(x.stderr||''));
    rows.push({command,at,elapsedMs:Date.now()-start,status:x.status,error:x.error?.message,evidence:path});
    writeFileSync(resolve(root,'gates.json'),JSON.stringify({environment:'Local Windows; synthetic Worker/Firestore transport; no deploy; Wrangler dry-run only',at,rows},null,2));
    console.log(JSON.stringify({command,status:x.status,elapsedMs:Date.now()-start}));
}
process.exitCode=rows.some(x=>x.status!==0)?1:0;
