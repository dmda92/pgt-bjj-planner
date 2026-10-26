/** A volatile editor draft. Coalesces keystrokes; a failure requires explicit
 * retry. Reconnection cannot replay a failed draft. The base advances only on
 * this editor's own ACK, never when an unrelated remote refresh arrives. */
export class OnlineDraft<T> {
    private current: T | undefined;
    private base: string | null = null;
    private timer: ReturnType<typeof setTimeout> | undefined;
    private failed = false;
    private revision = 0;
    private running: Promise<void> | undefined;

    constructor(privateSave: (data: T, base: string | null) => Promise<string>, privateFailure: (error: unknown) => void, privateDone: () => void, delay = 700) {
        this.save = privateSave;
        this.failure = privateFailure;
        this.done = privateDone;
        this.delay = delay;
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
        this.running = (async () => {
            if (this.failed) throw Error('Hay un borrador sin guardar. Reintenta o revisa la versión actual.');
            while (this.current !== undefined) {
                const value = this.current, revision = this.revision;
                try {
                    this.base = await this.save(value, this.base);
                    if (this.revision === revision) this.current = undefined;
                } catch (error) {
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
        this.failed = false;
        return this.flush();
    }

    discard() {
        clearTimeout(this.timer);
        this.current = undefined;
        this.failed = false;
        this.revision++;
        this.done();
    }
}
