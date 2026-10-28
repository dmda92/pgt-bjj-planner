import type { Techniques, Comments, Exercise, TrainingPlan } from './models.ts';

export interface CatalogPosition { id: string; priority: number; techniques: string[] }
export interface Cursor {
  priorities: number[];
  priority: number;
  move: 'second' | 'back' | 'forward';
  passes: Record<string, number>;
  pending: { positionId: string; techniqueId: string; complete: boolean }[];
}
export interface Continuity {
  version: 1;
  catalog: CatalogPosition[];
  boundaries: { date: string; signature: string; stateSignature: string; cursor: Cursor }[];
}
export const catalogOf = (t: Techniques): CatalogPosition[] => t.positions
  .filter(p => p.tecnicas.length).map(p => ({ id: p.id, priority: p.prioridad, techniques: p.tecnicas.map(t => t.id) }));
export const sessionSignature = (exercises: Exercise[]) => JSON.stringify(exercises.map(e => [e.positionId, e.techniqueId, e.prioridad, e.pass, e.positionComplete]));
/** Integrity checksum for persisted cursors; authorization still comes from read-only plan APIs. */
export function cursorSignature(cursor: Cursor): string {
  let hash=2166136261;
  for (const ch of JSON.stringify(cursor)) hash=Math.imul(hash^ch.charCodeAt(0),16777619);
  return (hash>>>0).toString(16);
}
export function initialCursor(catalog: CatalogPosition[]): Cursor {
  const priorities = [...new Set(catalog.map(p => p.priority))].sort((a,b) => a-b);
  if (!priorities.length) throw Error('No quedan técnicas entrenables. Recupera las técnicas del catálogo original o pide al entrenador que revise el plan.');
  return { priorities, priority: priorities[0], move: 'second', passes: {}, pending: [] };
}
function advance(c: Cursor) {
  const index = c.priorities.indexOf(c.priority);
  if (index < 0) throw Error('Cursor de prioridad no válido');
  c.priority = c.priorities[(index + (c.move === 'second' ? 1 : c.move === 'back' ? -1 : 2) + c.priorities.length) % c.priorities.length];
  c.move = c.move === 'back' ? 'forward' : 'back';
}
/** Finish the current occurrence, then adopt the surviving ring, retaining movement phase. */
export function nextExercise(c: Cursor, catalog: CatalogPosition[], t: Techniques, notes: Comments): Exercise {
  const priorities = [...new Set(catalog.map(p => p.priority))].sort((a,b)=>a-b);
  if (!priorities.length) throw Error('No quedan técnicas entrenables. Recupera las técnicas del catálogo original o pide al entrenador que revise el plan.');
  if (!c.pending.length) {
    if (Object.keys(c.passes).length) {
      // A deleted current priority retains its old anchor until the next valid occurrence.
      if (priorities.includes(c.priority)) c.priorities = priorities;
      for (let n=0;;n++) {
        advance(c);
        if (priorities.includes(c.priority)) break;
        if (n > c.priorities.length * 4) throw Error('No se puede reconstruir la continuidad de prioridades');
      }
      c.priorities = priorities;
    } else { c.priorities = priorities; c.priority = priorities[0]; }
    c.passes[c.priority] = (c.passes[c.priority] || 0) + 1;
    c.pending = catalog.filter(p=>p.priority===c.priority).flatMap(p=>p.techniques.map((id,i)=>({positionId:p.id, techniqueId:id, complete:i===p.techniques.length-1})));
  }
  const ref = c.pending.shift()!;
  const position = t.positions.find(p=>p.id===ref.positionId);
  const technique = position?.tecnicas.find(t=>t.id===ref.techniqueId);
  if (!position || !technique) throw Error('El cursor contiene una técnica que ya no existe');
  return {positionId:ref.positionId, techniqueId:ref.techniqueId, posicion:position.posicion, prioridad:c.priority, tipo:technique.tipo,
    descripcion_del_alumno:technique.descripcion_del_alumno, comment:notes.comments.find(n=>n.techniqueId===ref.techniqueId)?.comment || '',
    pass:c.passes[c.priority], positionComplete:ref.complete};
}
export function deletedUUIDs(previous: Techniques, next: Techniques): string[] {
  const retained = new Set(next.positions.flatMap(p=>[p.id,...p.tecnicas.map(t=>t.id)]));
  return previous.positions.flatMap(p=>[p.id,...p.tecnicas.map(t=>t.id)]).filter(id=>!retained.has(id));
}
function legacyContinuity(plan: TrainingPlan, reference?: CatalogPosition[]): Continuity {
  // Only migrate a legacy plan if its entire distribution reproduces the original generator.
  // At least two appearances of every known priority prove that its first pass was complete.
  const all = plan.sessions.flatMap(s=>s.exercises);
  const priorities = [...new Set(all.map(e=>e.prioridad))];
  if (!reference && priorities.some(p=>!all.some(e=>e.prioridad===p && e.pass>=2))) throw Error('Este plan antiguo no tiene un cursor reconstruible. El entrenador debe revisar su continuidad.');
  const catalog: CatalogPosition[]=reference ? structuredClone(reference) : [];
  if (!reference) for (const e of all.filter(e=>e.pass===1)) {
    let p=catalog.find(p=>p.id===e.positionId);
    if (!p) { p={id:e.positionId,priority:e.prioridad,techniques:[]};catalog.push(p); }
    if (p.techniques.includes(e.techniqueId)) throw Error('Cursor antiguo ambiguo');
    p.techniques.push(e.techniqueId);
  }
  const t: Techniques={schemaVersion:1,revision:1,updatedAt:plan.updatedAt,positions:catalog.map(p=>({id:p.id,posicion:'Legacy',prioridad:p.priority,tecnicas:p.techniques.map(id=>({id,tipo:'Legacy',descripcion_del_alumno:''}))}))};
  const cursor=initialCursor(catalog), boundaries:Continuity['boundaries']=[];
  for (const s of plan.sessions) {
    const expected=s.exercises.map(()=>nextExercise(cursor,catalog,t,{schemaVersion:1,revision:1,updatedAt:plan.updatedAt,comments:[]}));
    if (sessionSignature(expected)!==sessionSignature(s.exercises)) throw Error('Este plan antiguo tiene una secuencia incompatible. El entrenador debe revisar su continuidad.');
    boundaries.push({date:s.date,signature:sessionSignature(s.exercises),stateSignature:cursorSignature(cursor),cursor:structuredClone(cursor)});
  }
  return {version:1,catalog,boundaries};
}
export function updateFutureDeletions(plan: TrainingPlan, techniques: Techniques, comments: Comments, today: string): TrainingPlan {
  if (plan.fecha_torneo<=today || !plan.sessions.some(s=>s.date>today)) return plan;
  const applied=new Set(plan.appliedDeletions || []);
  const newRemovalEvent=(techniques.deletionRevision || 0)!==(plan.appliedDeletionRevision || 0);
  const deletions=(techniques.deletedIds || []).filter(id=>newRemovalEvent || !applied.has(id));
  if (!deletions.length && !plan.structuralUpdateError) return plan;
  const appliedDeletions=[...new Set([...(plan.appliedDeletions||[]),...(techniques.deletedIds||[])])];
  if (!plan.structuralUpdateError && !plan.sessions.some(s=>s.date>today&&s.exercises.some(e=>deletions.includes(e.positionId)||deletions.includes(e.techniqueId))))
    return {...plan,appliedDeletions,appliedDeletionRevision:techniques.deletionRevision || 0};
  try {
    let continuity=plan.continuity;
    if (!continuity) {
      try { continuity=legacyContinuity(plan,techniques.deletionCatalog); }
      catch { continuity=legacyContinuity(plan); }
    }
    if (continuity.version!==1 || continuity.boundaries.length!==plan.sessions.length || plan.sessions.some((s,i)=>continuity.boundaries[i].date!==s.date || continuity.boundaries[i].signature!==sessionSignature(s.exercises) || continuity.boundaries[i].stateSignature!==cursorSignature(continuity.boundaries[i].cursor))) throw Error('No se puede validar el cursor del plan. El entrenador debe revisar su continuidad.');
    const ids=new Set(techniques.positions.flatMap(p=>p.tecnicas.map(t=>t.id)));
    const positions=new Set(techniques.positions.map(p=>p.id));
    const catalog=continuity.catalog.filter(p=>positions.has(p.id)).map(p=>({...p,techniques:p.techniques.filter(id=>ids.has(id))})).filter(p=>p.techniques.length);
    if (!catalog.length) throw Error('No quedan técnicas entrenables. Recupera las técnicas del catálogo original o pide al entrenador que revise el plan.');
    const protectedCount=plan.sessions.filter(s=>s.date<=today).length;
    if (plan.sessions.some((s,i)=>i<protectedCount ? s.date>today : s.date<=today)) throw Error('El orden de fechas del plan no permite recuperar el cursor');
    const cursor=protectedCount ? structuredClone(continuity.boundaries[protectedCount-1].cursor) : initialCursor(catalog);
    if (!Array.isArray(cursor.pending) || !['second','back','forward'].includes(cursor.move) || !cursor.priorities?.includes(cursor.priority) || Object.values(cursor.passes).some(n=>!Number.isSafeInteger(n)||n<1)) throw Error('Cursor del plan no válido; requiere revisión del entrenador');
    if (protectedCount) {
      const protectedExercises=plan.sessions.slice(0,protectedCount).flatMap(s=>s.exercises);
      const last=protectedExercises.at(-1)!;
      const passes: Record<string,number>={};
      for (const e of protectedExercises) passes[e.prioridad]=Math.max(passes[e.prioridad]||0,e.pass);
      const consumed=new Set(protectedExercises.filter(e=>e.prioridad===cursor.priority&&e.pass===cursor.passes[cursor.priority]).map(e=>e.techniqueId));
      if (last.prioridad!==cursor.priority || last.pass!==cursor.passes[cursor.priority] || Object.keys(passes).length!==Object.keys(cursor.passes).length || Object.entries(passes).some(([p,n])=>cursor.passes[p]!==n) || new Set(cursor.pending.map(r=>r.techniqueId)).size!==cursor.pending.length || cursor.pending.some(r=>consumed.has(r.techniqueId)))
        throw Error('El cursor contradice el avance histórico; requiere revisión del entrenador');
    }
    cursor.pending=cursor.pending.filter(r=>positions.has(r.positionId)&&ids.has(r.techniqueId));
    // Recompute end-of-position markers on the surviving pending portion, without rewinding it.
    cursor.pending=cursor.pending.map((r,i,a)=>({...r,complete:!a.slice(i+1).some(n=>n.positionId===r.positionId)}));
    const boundaries=continuity.boundaries.slice(0,protectedCount);
    const sessions=plan.sessions.map((s,i)=>{
      if (i<protectedCount) return s;
      const exercises=Array.from({length:plan.ejercicios_por_sesion},()=>nextExercise(cursor,catalog,techniques,comments));
      boundaries.push({date:s.date,signature:sessionSignature(exercises),stateSignature:cursorSignature(cursor),cursor:structuredClone(cursor)});
      return {...s,exercises};
    });
    const {structuralUpdateError:_,...rest}=plan;
    return {...rest,sessions,continuity:{version:1,catalog,boundaries},appliedDeletions,appliedDeletionRevision:techniques.deletionRevision || 0};
  } catch (e) {
    const message=e instanceof Error ? e.message : 'No se puede actualizar el plan';
    return plan.structuralUpdateError===message ? plan : {...plan,structuralUpdateError:message};
  }
}
