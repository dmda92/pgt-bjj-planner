/** Independent QA oracle derived from the protocol's priority ring and array
 * order. It never imports the application's generator, continuity or codecs.
 * A visit consumes its complete priority block; session cuts are irrelevant.
 */
const priorities = source => [...new Set(source.positions.filter(p=>p.tecnicas.length).map(p=>p.prioridad))].sort((a,b)=>a-b);
const block = (source,priority,pass) => source.positions.filter(p=>p.prioridad===priority).flatMap(p=>p.tecnicas.map((t,i)=>({positionId:p.id,techniqueId:t.id,prioridad:priority,pass,positionComplete:i===p.tecnicas.length-1})));
export function referenceReflow(before,after,protectedExercises,count){
 const surviving=priorities(after);if(!surviving.length)return null;
 let ring=priorities(before),active=null,transition=0,queue=[],catalog=before;
 const passes=new Map();
 const offset=()=>{const result=transition===0?1:transition%2===1?-1:2;transition++;return result;};
 function take(){
  if(!queue.length){
   if(active===null){ring=priorities(catalog);active=ring[0];}
   else {const available=priorities(catalog);if(available.includes(active))ring=available;let tries=0;do{const anchor=ring.indexOf(active);if(anchor<0)throw Error('QA oracle lost priority anchor');active=ring[(anchor+offset()+ring.length)%ring.length];if(++tries>1000)throw Error('QA oracle has no surviving priority');}while(!available.includes(active));ring=available;}
   passes.set(active,(passes.get(active)||0)+1);queue=block(catalog,active,passes.get(active));
  }
  return queue.shift();
 }
 for(const saved of protectedExercises){const expected=take();for(const key of['positionId','techniqueId','prioridad','pass','positionComplete'])if(saved[key]!==expected[key])throw Error('Protected history does not match independent QA oracle: '+key);}
 catalog=after;const positions=new Set(after.positions.map(p=>p.id)),techniques=new Set(after.positions.flatMap(p=>p.tecnicas.map(t=>t.id)));
 queue=queue.filter(e=>positions.has(e.positionId)&&techniques.has(e.techniqueId)).map((e,i,all)=>({...e,positionComplete:!all.slice(i+1).some(next=>next.positionId===e.positionId)}));
 return Array.from({length:count},()=>take());
}
export const exerciseRefs = sessions => sessions.flatMap(s=>s.exercises.map(e=>({positionId:e.positionId,techniqueId:e.techniqueId,prioridad:e.prioridad,pass:e.pass,positionComplete:e.positionComplete})));
