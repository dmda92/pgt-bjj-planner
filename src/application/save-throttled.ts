export const DRAFT_SAVE_WAITING = 'El guardado está esperando al servidor. Conserva la sesión hasta que se confirme.';
/** Only a server 429 rejected before mutation may trigger a bounded draft retry. */
export class SaveThrottled extends Error {
    readonly status = 429;
    readonly retryAfterMs: number;
    constructor(retryAfterMs: number) {
        super(`Se ha alcanzado el límite temporal de guardados. Espera ${Math.ceil(retryAfterMs / 1000)} segundos; tu borrador se conserva.`);
        this.retryAfterMs = retryAfterMs;
    }
}
