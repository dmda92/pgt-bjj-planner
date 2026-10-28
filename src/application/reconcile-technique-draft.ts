import type {Techniques} from '../domain/models.ts';

export type DraftChoice = 'local' | 'remote';
export type TechniqueDraftConflict = {
    path: string;
    label: string;
    base: unknown;
    local: unknown;
    remote: unknown;
};
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const structure = (value: Techniques) => value.positions.map(p => ({id: p.id, prioridad: p.prioridad,
    techniques: p.tecnicas.map(t => t.id)}));

/** Review a failed online draft against its original base and a fresh source.
 * Server metadata always comes from remote. No writes, UUID reconstruction,
 * reordering, distribution calculation or implicit structural conflict policy.
 * Callers must require explicit choices for every returned conflict before saving.
 */
export function reconcileTechniqueDraft(base: Techniques, local: Techniques, remote: Techniques,
    choices: Record<string, DraftChoice> = {}): {merged: Techniques; conflicts: TechniqueDraftConflict[]} {
    const merged = structuredClone(remote), conflicts: TechniqueDraftConflict[] = [];
    const field = <T>(path: string, label: string, before: T, mine: T, theirs: T): T => {
        if (equal(mine, theirs) || equal(mine, before)) return structuredClone(theirs);
        if (equal(theirs, before)) return structuredClone(mine);
        if (choices[path] === 'remote') return structuredClone(theirs);
        if (choices[path] === 'local') return structuredClone(mine);
        conflicts.push({path, label, base: structuredClone(before), local: structuredClone(mine), remote: structuredClone(theirs)});
        return structuredClone(mine);
    };
    if (!equal(structure(base), structure(local)) || !equal(structure(base), structure(remote))) {
        // A concurrent text edit can target an entity removed or moved remotely.
        // Preserve whole arrays as explicit alternatives rather than infer intent.
        merged.positions = field('positions', 'Estructura completa del repertorio', base.positions, local.positions, remote.positions);
        return {merged, conflicts};
    }
    const basePositions = new Map(base.positions.map(p => [p.id, p]));
    const localPositions = new Map(local.positions.map(p => [p.id, p]));
    for (const position of merged.positions) {
        const before = basePositions.get(position.id)!, mine = localPositions.get(position.id)!;
        const prefix = 'positions/' + position.id;
        position.posicion = field(prefix + '/posicion', 'Nombre de posición: ' + position.posicion,
            before.posicion, mine.posicion, position.posicion);
        const baseTechniques = new Map(before.tecnicas.map(t => [t.id, t]));
        const localTechniques = new Map(mine.tecnicas.map(t => [t.id, t]));
        for (const technique of position.tecnicas) {
            const prior = baseTechniques.get(technique.id)!, edited = localTechniques.get(technique.id)!;
            const path = prefix + '/techniques/' + technique.id;
            technique.tipo = field(path + '/tipo', 'Nombre de técnica: ' + technique.tipo,
                prior.tipo, edited.tipo, technique.tipo);
            technique.descripcion_del_alumno = field(path + '/descripcion_del_alumno',
                'Descripción: ' + position.posicion + ' · ' + technique.tipo,
                prior.descripcion_del_alumno, edited.descripcion_del_alumno, technique.descripcion_del_alumno);
        }
    }
    return {merged, conflicts};
}
