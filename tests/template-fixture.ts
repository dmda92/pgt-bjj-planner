import type {Template} from "../src/domain/models.ts";
// Synthetic test records only. Never imported into the frontend bundle or real data repo.
// Shape mirrors the audited official counts; names/types deliberately carry no business data.
export const template: Template = {
    schemaVersion: 1,
    revision: 1,
    updatedAt: "2026-10-13T16:22:01.000Z",
    positions: [
        [1, 5],
        [1, 1],
        [1, 1],
        [1, 1],
        [1, 2],
        [1, 2],
        [1, 3],
        [1, 2],
        [1, 1],
        [1, 2],
        [1, 2],
        [2, 3],
        [2, 2],
        [2, 3],
        [2, 1],
        [2, 3],
        [2, 2],
    ].map(([prioridad, count], i) => ({
        posicion: `Posición sintética ${i + 1}`,
        prioridad,
        tecnicas: Array.from({length: count}, (_, j) => ({
            tipo: `Tipo sintético ${i + 1}/${j + 1}`,
            descripcion_del_alumno: "",
        })),
    })),
};
