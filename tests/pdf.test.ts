import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildPlanPdf} from '../src/infrastructure/pdf.ts';
import {generatePlan} from '../src/domain/planner.ts';
import {cloneTemplate,initialVersion,type Competition} from '../src/domain/models.ts';
import {template} from './template-fixture.ts';
const assets={logo:new Uint8Array(readFileSync('public/logo-pgt.jpg')),regular:readFileSync('public/fonts/Barlow-Regular.ttf').toString('base64'),bold:readFileSync('public/fonts/Barlow-SemiBold.ttf').toString('base64')};
const competition:Competition={planId:crypto.randomUUID(),fecha_comienzo:'2026-10-08',fecha_torneo:'2026-12-13',alumnos:['pdf@example.com'],dias_de_entrenamiento:[2,4],ejercicios_por_sesion:5,tiempo_por_tecnica_segundos:180,descanso_entre_ciclos_segundos:10,descanso_entre_tecnicas_segundos:20};
const plan=()=>generatePlan(competition,'pdf@example.com',cloneTemplate(template),{...initialVersion(),comments:[]},'2026-10-08T12:00:00Z');
test('PDF preserves snapshot and chronology, keeps entire sessions inside non-overlapping page cards',async()=>{
 const source=plan(),before=JSON.stringify(source);
 const {pdf,placements}=await buildPlanPdf(source,assets);
 assert.equal(JSON.stringify(source),before);
 assert.deepEqual(placements.map(p=>p.date),source.sessions.map(s=>s.date));
 for(const p of placements){assert.ok(p.page>=2);assert.ok(p.y>=39);assert.ok(p.y+p.height<=276);assert.ok(p.x+p.width<=194);}
 for(let i=0;i<placements.length;i++)for(let j=i+1;j<placements.length;j++){
  const a=placements[i],b=placements[j];if(a.page!==b.page)continue;
  assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y,'Cards overlap');
 }
 assert.ok(pdf.output('arraybuffer').byteLength>10000);
});
test('Dense sessions use full width; very long sessions continue without rejecting or changing texts',async()=>{
 const source=plan();source.sessions=source.sessions.slice(0,1);
 for(const ex of source.sessions[0].exercises){ex.descripcion_del_alumno='Descripción larga con acentos y ángulo. '.repeat(12);ex.comment='Comentario del entrenador para practicar.';}
 const {placements}=await buildPlanPdf(source,assets);
 assert.equal(placements.length,1);assert.equal(placements[0].width,178);
 for(const ex of source.sessions[0].exercises)ex.descripcion_del_alumno='Texto imposible de encajar. '.repeat(1000);
 const before=JSON.stringify(source);
 const continued=await buildPlanPdf(source,assets);
 assert.ok(continued.placements.length>1);
 assert.ok(continued.placements.every(p=>p.date===source.sessions[0].date&&p.width===178&&p.y+p.height<=276));
 assert.equal(JSON.stringify(source),before);
});
test('PDF accepts variable Tabata, zero rests, empty plans and long names',async()=>{
 const source=plan();source.ejercicios_por_sesion=3;source.tiempo_por_tecnica_segundos=60;source.descanso_entre_ciclos_segundos=0;source.descanso_entre_tecnicas_segundos=0;
 for(const s of source.sessions){s.exercises=s.exercises.slice(0,3);for(const e of s.exercises)e.posicion='Posición con nombre muy largo y caracteres españoles áéíóú ñ '.repeat(3);}
 const result=await buildPlanPdf(source,assets);assert.equal(result.placements.length,19);
 source.sessions=[];const empty=await buildPlanPdf(source,assets);assert.equal(empty.pdf.getNumberOfPages(),1);assert.deepEqual(empty.placements,[]);
});
