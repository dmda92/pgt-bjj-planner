import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reconcileTechniqueDraft} from '../src/application/reconcile-technique-draft.ts';
import {cloneTemplate} from '../src/domain/models.ts';
import {template} from './template-fixture.ts';

test('UUID three-way review preserves independent edits while resolving a divergent description', () => {
    const base=cloneTemplate(template), local=structuredClone(base), remote=structuredClone(base);
    local.positions[0].tecnicas[0].descripcion_del_alumno='local conflict';
    local.positions[0].tecnicas[1].descripcion_del_alumno='independent local';
    remote.positions[0].tecnicas[0].descripcion_del_alumno='remote conflict';
    remote.positions[0].posicion='Remote position label';remote.revision++;
    const before=JSON.stringify([base,local,remote]), pending=reconcileTechniqueDraft(base,local,remote);
    assert.equal(pending.conflicts.length,1);
    assert.equal(pending.merged.positions[0].tecnicas[1].descripcion_del_alumno,'independent local');
    assert.equal(pending.merged.positions[0].posicion,'Remote position label');
    const result=reconcileTechniqueDraft(base,local,remote,{[pending.conflicts[0].path]:'remote'});
    assert.equal(result.conflicts.length,0);
    assert.equal(result.merged.positions[0].tecnicas[0].descripcion_del_alumno,'remote conflict');
    assert.equal(result.merged.positions[0].tecnicas[1].descripcion_del_alumno,'independent local');
    assert.equal(result.merged.revision,remote.revision);
    assert.equal(JSON.stringify([base,local,remote]),before);
});

test('Divergent names have local/remote choices without affecting sibling fields or order', () => {
    const base=cloneTemplate(template), local=structuredClone(base), remote=structuredClone(base);
    local.positions[0].tecnicas[0].tipo='local name';remote.positions[0].tecnicas[0].tipo='remote name';
    local.positions[1].posicion='Local other position';remote.positions[1].tecnicas[0].descripcion_del_alumno='Remote other text';
    const pending=reconcileTechniqueDraft(base,local,remote);
    const result=reconcileTechniqueDraft(base,local,remote,{[pending.conflicts[0].path]:'local'});
    assert.equal(result.merged.positions[0].tecnicas[0].tipo,'local name');
    assert.equal(result.merged.positions[1].posicion,'Local other position');
    assert.equal(result.merged.positions[1].tecnicas[0].descripcion_del_alumno,'Remote other text');
    assert.deepEqual(result.merged.positions.map(p=>[p.id,p.tecnicas.map(t=>t.id)]),base.positions.map(p=>[p.id,p.tecnicas.map(t=>t.id)]));
});

for (const change of ['order','priority','deletion','addition'] as const) {
    test(`Concurrent ${change} and text changes require an explicit entire-structure choice`, () => {
        const base=cloneTemplate(template), local=structuredClone(base), remote=structuredClone(base);
        local.positions[0].tecnicas[0].descripcion_del_alumno='local text';
        if(change==='order')remote.positions.reverse();
        if(change==='priority')remote.positions[0].prioridad++;
        if(change==='deletion')remote.positions[0].tecnicas.shift();
        if(change==='addition')remote.positions[0].tecnicas.push({id:crypto.randomUUID(),tipo:'new',descripcion_del_alumno:''});
        const pending=reconcileTechniqueDraft(base,local,remote);
        assert.equal(pending.conflicts.length,1);assert.equal(pending.conflicts[0].path,'positions');
        for(const choice of ['local','remote'] as const){
            const result=reconcileTechniqueDraft(base,local,remote,{positions:choice});
            assert.equal(result.conflicts.length,0);
            assert.deepEqual(result.merged.positions,choice==='local'?local.positions:remote.positions);
        }
    });
}

test('Identical concurrent changes and unchanged local data produce no conflicts',()=>{
    const base=cloneTemplate(template),remote=structuredClone(base);
    remote.positions[0].tecnicas[0].descripcion_del_alumno='same';
    assert.equal(reconcileTechniqueDraft(base,remote,remote).conflicts.length,0);
    assert.deepEqual(reconcileTechniqueDraft(base,base,remote).merged,remote);
});
