import React,{useState,useEffect,useMemo} from 'react';
import {client,ApiFailure} from './application/client.ts';
import type {TrainerView} from './application/trainer-cache.ts';
import type {Techniques} from './domain/models.ts';
import {preparation,type TrainingDay} from './domain/trainer-reports.ts';
export function Loading({children='Cargando…'}:{children?:React.ReactNode}){return <p className="competition-loading" role="status"><span className="loading-spinner" aria-hidden="true"/>{children}</p>;}
type Run=(a:()=>Promise<unknown>)=>Promise<void>;
export function TrainerPreparation({students,run}:{students:any[];run:Run}){
 const [mail,setMail]=useState(''),[planId,setPlanId]=useState(''),[view,setView]=useState<TrainerView|null>(null),[source,setSource]=useState<Techniques|null>(null),[detail,setDetail]=useState<TrainerView|null>(null),[loading,setLoading]=useState(false),[planLoading,setPlanLoading]=useState(false),[filter,setFilter]=useState('all');
 useEffect(()=>{let current=true;setView(null);setSource(null);setDetail(null);setPlanId('');if(!mail){setLoading(false);return;}setLoading(true);
  void run(async()=>{try{const cached=await Promise.all([client.cachedTrainer(mail,'techniques'),client.cachedTrainer(mail,'plans')]);if(current&&cached[0]&&cached[1]){setSource(cached[0].techniques!.data);setView(cached[1]);}
   const [t,p]=await Promise.all([client.trainerView(mail,'techniques'),client.trainerView(mail,'plans')]);if(current){setSource(t.techniques!.data);setView(p);setPlanId(p.planSummaries?.[0]?.planId||'');}
  }catch(e){if(current&&e instanceof ApiFailure&&(e.status===401||e.status===403)){setView(null);setSource(null);}throw e;}finally{if(current)setLoading(false);}});return()=>{current=false;};
 },[mail]);
 useEffect(()=>{let current=true;setDetail(null);if(!mail||!planId){setPlanLoading(false);return;}setPlanLoading(true);
  void run(async()=>{try{const cached=await client.cachedTrainer(mail,'plans',planId);if(current&&cached)setDetail(cached);const data=await client.trainerView(mail,'plans',false,planId);if(current)setDetail(data);}catch(e){if(current&&e instanceof ApiFailure&&(e.status===401||e.status===403))setDetail(null);throw e;}finally{if(current)setPlanLoading(false);}});return()=>{current=false;};
 },[mail,planId]);
 const plan=detail?.plans?.find(p=>p.data.planId===planId)?.data;
 const report=useMemo(()=>plan&&source?preparation(plan,source):null,[plan,source]);
 const percent=(n:number,d:number)=>d?`${(n/d*100).toLocaleString('es-ES',{maximumFractionDigits:1})} %`:'—';
 return <section className="coverage-area" aria-label="Cobertura por alumno">
  <p>Preparación del repertorio actual y contenido de la instantánea completa del plan. No registra asistencia real.</p>
  <div className="card coverage-controls"><label>Alumno para cobertura<select value={mail} onChange={e=>setMail(e.target.value)}><option value="">Selecciona un alumno</option>{students.map(s=><option key={s.profile.mail} value={s.profile.mail}>{[s.profile.nombre,s.profile.apellidos].filter(Boolean).join(' ')||s.profile.mail}</option>)}</select></label>
   <label>Plan para cobertura<select value={planId} disabled={!view?.planSummaries?.length} onChange={e=>setPlanId(e.target.value)}><option value="">Selecciona un plan</option>{view?.planSummaries?.map(p=><option key={p.planId} value={p.planId}>Torneo · {p.fecha_torneo||p.planId}</option>)}</select></label></div>
  {(loading||planLoading)&&<Loading>{report?'Actualizando preparación…':'Cargando preparación…'}</Loading>}
  {!mail&&<p className="empty">Selecciona un alumno y su plan.</p>}
  {mail&&view&&!view.planSummaries?.length&&!loading&&<p className="empty">Este alumno no tiene planes generados. Debe sincronizar su cuenta para recibir un plan asignado.</p>}
  {report&&<>
   {plan?.structuralUpdateError&&<p role="alert">El plan tiene una actualización bloqueada. Se analiza la última instantánea guardada.</p>}
   <dl className="coverage-overview"><div><dt>Técnicas del plan con descripción</dt><dd>{report.described} / {report.planned}</dd><p>{percent(report.described,report.planned)} preparadas</p></div><div><dt>Cobertura del repertorio</dt><dd>{report.covered} / {report.total}</dd><p>{percent(report.covered,report.total)} programado</p></div><div><dt>Sesiones del plan</dt><dd>{report.sessions}</dd><p>{report.appearances} apariciones · {report.appearances-report.planned} repeticiones adicionales</p></div></dl>
   <h3>Cobertura por prioridad</h3><div className="coverage-table" role="region" aria-label="Cobertura por prioridad" tabIndex={0}><table><thead><tr><th>Prioridad</th><th>Repertorio</th><th>Programadas del repertorio</th><th>Cobertura</th><th>Con descripción / del plan</th><th>Apariciones</th><th>Veces por prioridad</th></tr></thead><tbody>{report.rows.map(r=><tr key={r.priority}><td>P{r.priority}</td><td>{r.total}</td><td>{r.covered}</td><td>{percent(r.covered,r.total)}</td><td>{r.described} / {r.planned}</td><td>{r.appearances}</td><td>{r.total ? (r.appearances/r.total).toLocaleString("es-ES",{minimumFractionDigits:2,maximumFractionDigits:2}) : "—"}</td></tr>)}</tbody></table></div>
   <p className="coverage-scope">El repertorio actual es el denominador, tenga o no descripción. «Veces por prioridad» divide las apariciones entre el repertorio de esa prioridad. {report.items.filter(t=>!t.inRepertoire).length} técnicas de la instantánea ya no están en el repertorio; se conservan en el detalle y no aumentan la cobertura del repertorio actual. Su descripción actual no está disponible. La tabla agregada usa las prioridades del repertorio actual; el detalle conserva las de la instantánea.</p>
   <h3>Técnicas sin descripción más repetidas</h3>{report.missing.length?<ol>{report.missing.slice(0,5).map(t=><li key={t.id}>{t.position} · {t.type}: {t.count} apariciones</li>)}</ol>:<p>Todas las técnicas del plan tienen descripción.</p>}
   <div className="section-head"><h3>Detalle por posición y técnica</h3><label>Filtrar cobertura<select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">Todo el plan</option><option value="missing">Sin descripción</option><option value="removed">Fuera del repertorio actual</option></select></label></div>
   <div className="coverage-table" role="region" aria-label="Detalle de cobertura" tabIndex={0}><table><thead><tr><th>Prioridad</th><th>Posición</th><th>Técnica</th><th>Descripción actual</th><th>Apariciones en todo el plan</th></tr></thead><tbody>{report.items.filter(t=>filter==='all'||filter==='missing'&&!t.described||filter==='removed'&&!t.inRepertoire).map(t=><tr key={t.id}><td>P{t.snapshotPriority}</td><td>{t.position}</td><td>{t.type}</td><td>{!t.inRepertoire?'Fuera del repertorio':t.described?'Sí':'Pendiente'}</td><td>{t.count}</td></tr>)}</tbody></table></div>
  </>}
 </section>;
}
export function TrainerDay({run}:{run:Run}){
 const [date,setDate]=useState(''),[data,setData]=useState<TrainingDay|null>(null),[loading,setLoading]=useState(false);
 useEffect(()=>{let current=true;setData(null);setLoading(true);void run(async()=>{try{const cached=await client.cachedTrainingDay(date);if(current&&cached)setData(cached);const value=await client.trainingDay(date);if(current)setData(value);}catch(e){if(current&&e instanceof ApiFailure&&(e.status===401||e.status===403))setData(null);throw e;}finally{if(current)setLoading(false);}});return()=>{current=false;};},[date]);
 return <section aria-label="Entrenamiento del día"><label>Fecha del entrenamiento<input type="date" value={date||data?.date||''} onChange={e=>setDate(e.target.value)}/></label><p>Se agrupan las sesiones guardadas por posición y técnica, incluyendo sus cantidades. No se comparan descripciones, comentarios ni orden. La fecha inicial es el próximo entrenamiento posterior a hoy.</p>
 {loading&&<Loading>{data?'Comprobando cambios…':'Cargando entrenamientos…'}</Loading>}
 {data&&<>{(data.missing>0||data.blocked>0)&&<p role="alert">Vista incompleta o pendiente: {data.missing} planes asignados aún sin instantánea y {data.blocked} planes con actualización bloqueada. No se generan planes al consultar.</p>}
 {!data.date&&<p className="empty">No hay próximas fechas en los planes activos. Selecciona una fecha para consultar las sesiones guardadas.</p>}
 {data.date&&!data.groups.length&&<p className="empty">No hay entrenamientos guardados para esta fecha.</p>}
 <div className="day-groups">{data.groups.map((g,i)=><article className="card day-group" key={g.key}><div className="section-head"><h3>Plan {i+1} · {data.date}</h3><strong className="student-count" aria-label={`${g.students.length} ${g.students.length===1?"alumno":"alumnos"}`}>{g.students.length} {g.students.length===1?"alumno":"alumnos"}</strong></div><p><strong>Alumnos:</strong> {g.students.map(s=>s.name).join(', ')}</p><ol>{g.exercises.map(([position,type],j)=><li key={j}><strong>{position}</strong> · {type}</li>)}</ol>{g.competitions.length>1&&<p className="muted">Compartido entre {g.competitions.length} competiciones.</p>}</article>)}</div></>}
 </section>;
}
