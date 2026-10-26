import { validateTechniques, type Techniques } from '../domain/models.ts';

export const POSITION_NAME_REQUIRED = 'Completa el nombre de la posición para guardar los cambios.';
export const TECHNIQUE_NAME_REQUIRED = 'Completa el nombre de la técnica para guardar los cambios.';
/** Empty names are normal intermediate editor states, never valid stored data. */
export function techniqueDraftMessage(value: Techniques): string | null {
    if (value.positions.some(p => !p.posicion.trim())) return POSITION_NAME_REQUIRED;
    if (value.positions.some(p => p.tecnicas.some(t => !t.tipo.trim()))) return TECHNIQUE_NAME_REQUIRED;
    try { validateTechniques(value); return null; }
    catch (error) { return error instanceof Error ? error.message : 'Revisa los datos de las técnicas antes de guardar.'; }
}
