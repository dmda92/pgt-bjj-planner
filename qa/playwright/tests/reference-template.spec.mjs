import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { caseTest, campaign, expect } from '../helpers/case-test.mjs';
caseTest('TEC 01',{environment:'Comparación de snapshots DEV reales iniciales con referencia oficial independiente, sin mutaciones',users:['A','B']},async({},r)=>{
    r.includePrevious();const path=resolve(campaign,'reference-official-template.json');
    if(!existsSync(path)){r.finish('PARCIAL','Falta referencia oficial independiente proporcionada para esta campaña.','No sustituirla por el generador ni por otra cuenta; registrar fuente y hash antes de comparar.');return;}
    await r.step('Comparar literalmente nombres/tipos/prioridades/orden inicial A/B con plantilla oficial independiente',async()=>{
        const reference=JSON.parse(readFileSync(path,'utf8')),initial=JSON.parse(readFileSync(resolve(campaign,'initial-snapshots.json'),'utf8'));
        const shape=s=>s.techniques.data.positions.map(p=>({name:p.posicion,priority:p.prioridad,types:p.tecnicas.map(t=>t.tipo)}));expect(shape(initial.A)).toEqual(reference.positions);expect(shape(initial.B)).toEqual(reference.positions);
        const ids=s=>s.techniques.data.positions.flatMap(p=>[p.id,...p.tecnicas.map(t=>t.id)]),a=ids(initial.A),b=ids(initial.B);expect(a.filter(id=>b.includes(id))).toEqual([]);expect(new Set(a).size).toBe(a.length);expect(new Set(b).size).toBe(b.length);
        for(const s of [initial.A,initial.B])expect(s.techniques.data.positions.some(p=>Object.hasOwn(p,'order'))).toBe(false);
        await r.json('independent-literal-template',{reference,initialA:initial.A.techniques,initialB:initial.B.techniques,method:'Comparación de estados iniciales recogidos en esta campaña, sin reutilizar resultados de campañas anteriores.'});
    });r.finish('APROBADO','Plantilla independiente coincide literalmente con A y B iniciales; orden/UUID exclusivos/sin order verificados. Estabilidad tras login/recarga y ediciones se conserva en evidencias previas de esta campaña.','La referencia es un documento oficial original independiente; los snapshots DEV son lecturas autenticadas mediadas por backend, no acceso administrativo directo a Firestore.');
});
