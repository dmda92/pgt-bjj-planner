import {ApiError} from '../security.ts';

export interface SessionStore {
    get<T>(key: string): Promise<T | undefined>;

    put<T>(key: string, value: T): Promise<void>;

    delete(key: string): Promise<boolean>;

    list<T>(options: { prefix: string }): Promise<Map<string, T>>;
}

export type SessionChange = { key: string; value?: unknown; deleted?: boolean };
export const sessionKey = (key: string) => key.startsWith('app-session:') || key.startsWith('plan-update:');

/** Private request replica: session and checkpoint metadata only, never business data. */
export class SessionReplica implements SessionStore {
    private values: Map<string, unknown>;
    private pending = new Map<string, SessionChange>();

    constructor(entries: [string, unknown][]) {
        if (entries.some(([key]) => !sessionKey(key))) throw new ApiError(500, 'PRIVATE_SESSION_KEY_INVALID');
        this.values = new Map(structuredClone(entries));
    }

    async get<T>(key: string) {
        this.check(key);
        return structuredClone(this.values.get(key)) as T | undefined;
    }

    async put<T>(key: string, value: T) {
        this.check(key);
        const copy = structuredClone(value);
        this.values.set(key, copy);
        this.pending.set(key, {key, value: copy});
    }

    async delete(key: string) {
        this.check(key);
        const found = this.values.delete(key);
        this.pending.set(key, {key, deleted: true});
        return found;
    }

    async list<T>({prefix}: { prefix: string }) {
        this.check(prefix);
        return new Map([...this.values].filter(([key]) => key.startsWith(prefix)).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => [key, structuredClone(value) as T]));
    }

    changes() {
        return structuredClone([...this.pending.values()]);
    }

    private check(key: string) {
        if (!sessionKey(key)) throw new ApiError(500, 'PRIVATE_SESSION_KEY_INVALID');
    }
}
