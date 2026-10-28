import {readFileSync,writeFileSync,readdirSync,existsSync,mkdirSync,statSync} from 'node:fs';
import {resolve,relative,sep} from 'node:path';
import {createHash} from 'node:crypto';

const root=resolve(process.argv[2]||''),manifestPath=resolve(root,'manifest.json');
if(!process.argv[2]||!existsSync(manifestPath))throw Error('Usage: node qa/tools/build_report_index.mjs <campaign directory>');
const json=path=>JSON.parse(readFileSync(path,'utf8').replace(/^\uFEFF/,''));
const manifest=json(manifestPath),reports=resolve(root,'reports');mkdirSync(reports,{recursive:true});
const statuses=['APROBADO','FALLIDO','PARCIAL','BLOQUEADO','NO APLICA','NO EJECUTADO'];
const sha=value=>createHash('sha256').update(value).digest('hex');
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const within=path=>{const rel=relative(root,path);return rel!==''&&!rel.startsWith('..'+sep)&&rel!=='..'&&!resolve(rel).startsWith('\\\\');};
const href=path=>relative(reports,path).split(sep).map(part=>encodeURIComponent(part)).join('/');
const link=(path,label)=>existsSync(path)&&within(path)?`<a href="${escape(href(path))}">${escape(label)}</a>`:`${escape(label)} (no disponible)`;
const files=directory=>existsSync(directory)?readdirSync(directory).filter(f=>f.endsWith('.json')):[];
const counts=Object.fromEntries(statuses.map(s=>[s,0])),missingEvidence=[],invalid=[],resultFiles=[];
const attempts=files(resolve(root,'attempts')).map(name=>{const path=resolve(root,'attempts',name),row=json(path);return{id:row.id,status:row.status,executedAt:row.executedAt,path};});
const known=new Set(manifest.cases.map(c=>c.id));
for(const name of files(resolve(root,'results'))){const row=json(resolve(root,'results',name));if(!known.has(row.id))throw Error('Unknown result ID: '+row.id);}
const cases=manifest.cases.map(item=>{
 const path=resolve(root,'results',item.id.replaceAll(' ','-')+'.json'),has=existsSync(path),raw=has?readFileSync(path):null,row=raw?JSON.parse(raw.toString('utf8').replace(/^\uFEFF/,'')):null;
 const status=row?.status||'NO EJECUTADO';if(!statuses.includes(status))throw Error('Invalid status '+item.id);counts[status]++;
 if(row?.status==='APROBADO'&&(!row.observed||!row.steps?.length||!row.evidence?.length))invalid.push(item.id);
 const evidence=(row?.evidence||[]).map(ref=>{if(/^https?:\/\//.test(ref))return{ref,url:true};const path=resolve(root,ref);if(!existsSync(path))missingEvidence.push({id:item.id,ref});return{ref,path,exists:existsSync(path),withinCampaign:within(path)};});
 if(raw)resultFiles.push({id:item.id,path:relative(root,path).split(sep).join('/'),sha256:sha(raw)});
 return{id:item.id,title:item.title,status,path:has?path:null,executedAt:row?.executedAt||null,environment:row?.environment||'',evidence,attempts:attempts.filter(a=>a.id===item.id)};
});
const phases=readdirSync(root).filter(name=>name.startsWith('playwright-results-')&&name.endsWith('.json')).sort().map(name=>{
 const path=resolve(root,name),body=json(path),suffix=name.slice('playwright-results-'.length,-'.json'.length),report=resolve(root,'playwright-report-'+suffix,'index.html');
 return{name:suffix,path,report:existsSync(report)?report:null,startTime:body.stats?.startTime||null,duration:body.stats?.duration||null,stats:body.stats||{},generatedAt:statSync(path).mtime.toISOString()};
});
const complete=counts.APROBADO+counts.FALLIDO;
const state={generatedAt:new Date().toISOString(),campaign:manifest.campaign,scope:'Read-only snapshot of current case records. Does not execute, approve, edit or close any case.',sourceSha256:manifest.sourceSha256,total:manifest.cases.length,counts,fullyExecuted:complete,fullyExecutedPercent:100*complete/manifest.cases.length,approvalOfFullyExecutedPercent:complete?100*counts.APROBADO/complete:null,pending:cases.filter(c=>c.status==='NO EJECUTADO').map(c=>c.id),invalidApprovals:invalid,missingEvidence,resultFiles,resultSetSha256:sha(JSON.stringify(resultFiles)),phaseReports:phases.map(p=>({name:p.name,stats:p.stats,path:relative(root,p.path).split(sep).join('/')}))};
writeFileSync(resolve(reports,'checkpoint-index.json'),JSON.stringify(state,null,2)+'\n');
const nav=['resultados.docx','executive-summary.md','incidents.md','case-results.html','audit.json','checkpoint-index.json'].map(name=>link(resolve(reports,name),name)).join(' · ');
const html=`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Campaña QA ${escape(manifest.campaign)}</title>
<style>body{font:16px system-ui,sans-serif;color:#20313f;max-width:1400px;margin:2rem auto;padding:0 1.5rem}h1,h2{color:#000}table{width:100%;border-collapse:collapse;margin:1rem 0 2rem}th,td{padding:.65rem;border:1px solid #d9d9d9;text-align:left;vertical-align:top}th{background:#eef2f6}tr:nth-child(even){background:#f8fafc}a{color:#23547a}small{display:block;color:#475569}details{margin:.3rem 0}input,select{font:inherit;padding:.5rem;margin:.3rem}td{overflow-wrap:anywhere}code{overflow-wrap:anywhere}.metrics{display:flex;gap:1rem;flex-wrap:wrap}</style>
<h1>Campaña QA ${escape(manifest.campaign)}</h1><p>Estado reconstruido el ${escape(state.generatedAt)}. Cada ficha conserva su entorno y las evidencias de todos sus intentos; este índice no añade aprobaciones.</p><p>${nav}</p>
<div class="metrics">${statuses.map(s=>`<span><b>${escape(s)}</b> ${counts[s]}</span>`).join('')}</div>
<p>Ejecución completa ${state.fullyExecutedPercent.toFixed(2)}% (${complete}/${state.total}). Aprobación sobre ejecución completa ${state.approvalOfFullyExecutedPercent?.toFixed(2)??'no calculable'}%. PARCIAL, BLOQUEADO, NO APLICA y NO EJECUTADO no cuentan como aprobación.</p>
<p>Evidencias ausentes ${missingEvidence.length}. Aprobaciones incompletas ${invalid.length}. ${link(resolve(reports,'checkpoint-index.json'),'Snapshot reanudable del índice')}. Los resultados oficiales siguen en results y el manifiesto permanece intacto.</p>
<h2>Informes de Playwright por ejecución</h2><table><thead><tr><th>Fase e intento</th><th>Fecha</th><th>Resultado del runner</th><th>Archivos</th></tr></thead><tbody>${phases.map(p=>`<tr><td>${escape(p.name)}</td><td>${escape(p.startTime||p.generatedAt)}</td><td>Esperados ${p.stats.expected??0}; inesperados ${p.stats.unexpected??0}; omitidos ${p.stats.skipped??0}; inestables ${p.stats.flaky??0}</td><td>${p.report?link(p.report,'HTML'):'HTML no disponible'} · ${link(p.path,'JSON')}</td></tr>`).join('')}</tbody></table>
<h2>Resultados individuales</h2><label>Buscar <input id="query" type="search"></label><label>Estado <select id="status"><option value="">Todos</option>${statuses.map(s=>`<option>${escape(s)}</option>`).join('')}</select></label>
<table id="cases"><thead><tr><th>Caso</th><th>Estado y entorno</th><th>Evidencias e intentos</th></tr></thead><tbody>${cases.map(c=>`<tr data-status="${escape(c.status)}"><td><b>${escape(c.id)}</b> ${escape(c.title)}<small>${escape(c.executedAt)}</small></td><td>${escape(c.status)}<small>${escape(c.environment)}</small>${c.path?link(c.path,'Registro actual'):''}</td><td><details><summary>${c.evidence.length} evidencias y ${c.attempts.length} intentos anteriores</summary><ul>${c.evidence.map((e,i)=>`<li>${e.url?`Referencia externa ${escape(e.ref)}`:e.withinCampaign?link(e.path,'Evidencia '+(i+1)+': '+relative(root,e.path).split(sep).join('/')):'Referencia fuera de campaña: '+escape(e.ref)}</li>`).join('')}</ul><ul>${c.attempts.map(a=>`<li>${link(a.path,`${a.status} ${a.executedAt||''}`)}</li>`).join('')}</ul></details></td></tr>`).join('')}</tbody></table>
<script>const rows=[...document.querySelectorAll('#cases tbody tr')],query=document.querySelector('#query'),status=document.querySelector('#status');function filter(){for(const row of rows)row.hidden=!!((status.value&&row.dataset.status!==status.value)||(query.value&&!row.textContent.toLowerCase().includes(query.value.toLowerCase())));}query.addEventListener('input',filter);status.addEventListener('change',filter);</script></html>`;
writeFileSync(resolve(reports,'index.html'),html);console.log(JSON.stringify({campaign:manifest.campaign,total:state.total,counts,index:resolve(reports,'index.html'),missingEvidence:missingEvidence.length,invalidApprovals:invalid.length}));
