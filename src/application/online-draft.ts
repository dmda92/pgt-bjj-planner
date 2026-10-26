import { SaveThrottled } from './save-throttled.ts';
/** A volatile editor draft. Coalesces keystrokes; a failure requires explicit
 * retry. Reconnection cannot replay a failed draft. The base advances only on
 * this editor's own ACK, never when an unrelated remote refresh arrives.
 * One brief server throttle may retry the latest draft while still online. */
export class OnlineDraft<T> {
    private current: T | undefined;
    private base: string | null = null;
    private timer: ReturnType<typeof setTimeout> | undefined;
    private failed = false;
    private revision = 0;
    private running: Promise<void> | undefined;
    private waitingUntil = 0;
    private retriedThrottle = false;
    private canRetry: () => boolean;
    private retryGeneration: () => number;
    private waitingGeneration = 0;

    constructor(privateSave: (data: T, base: string | null) => Promise<string>, privateFailure: (error: unknown) => void, privateDone: () => void, delay = 1200, canRetry = () => true, retryGeneration = () => 0) {
        this.save = privateSave;
        this.failure = privateFailure;
        this.done = privateDone;
        this.delay = delay;
        this.canRetry = canRetry;
        this.retryGeneration = retryGeneration;
    }

    private save: (data: T, base: string | null) => Promise<string>;
    private failure: (error: unknown) => void;
    private done: () => void;
    private delay: number;

    get value() {
        return this.current;
    }

    get hasDraft() {
        return this.current !== undefined;
    }

    get hasFailed() {
        return this.failed;
    }

    update(value: T, base: string | null) {
        if (this.current === undefined) this.base = base;
        this.current = structuredClone(value);
        this.revision++;
        clearTimeout(this.timer);
        if (!this.failed) this.timer = setTimeout(() => void this.flush().catch(() => {
        }), this.delay);
    }

    async flush(): Promise<void> {
        clearTimeout(this.timer);
        if (this.running) return this.running;
        if (!this.failed && this.waitingUntil > Date.now()) {
            this.timer = setTimeout(() => void this.flush().catch(() => {}), this.waitingUntil - Date.now());
            return;
        }
        this.running = (async () => {
            if (this.failed) throw Error('Hay un borrador sin guardar. Reintenta o revisa la versión actual.');
            if (this.waitingUntil) {
                this.waitingUntil = 0;
                if (!this.canRetry() || this.waitingGeneration !== this.retryGeneration()) {
                    const error = Error('El borrador se conserva. Reintenta el guardado cuando tengas conexión y la misma sesión.');
                    this.failed = true; this.failure(error); throw error;
                }
            }
            while (this.current !== undefined) {
                const value = this.current, revision = this.revision, generation = this.retryGeneration();
                try {
                    this.base = await this.save(value, this.base);
                    this.retriedThrottle = false;
                    if (this.revision === revision) this.current = undefined;
                } catch (error) {
                    if (error instanceof SaveThrottled) {
                        this.waitingUntil = Date.now() + error.retryAfterMs;
                        this.waitingGeneration = generation;
                        if (!this.retriedThrottle && error.retryAfterMs <= 60000 && this.canRetry() && generation === this.retryGeneration()) {
                            this.retriedThrottle = true;
                            this.timer = setTimeout(() => void this.flush().catch(() => {}), error.retryAfterMs);
                            return;
                        }
                    }
                    this.failed = true;
                    this.failure(error);
                    throw error;
                }
            }
        })().finally(() => {
            this.running = undefined;
            if (this.current === undefined) clearTimeout(this.timer);
            this.done();
        });
        return this.running;
    }

    async retry() {
        if (this.waitingUntil > Date.now()) throw new SaveThrottled(this.waitingUntil - Date.now());
        this.failed = false;
        this.retriedThrottle = false;
        this.waitingGeneration = this.retryGeneration();
        return this.flush();
    }

    discard() {
        clearTimeout(this.timer);
        this.current = undefined;
        this.failed = false;
        this.waitingUntil = 0;
        this.retriedThrottle = false;
        this.revision++;
        this.done();
    }
}
