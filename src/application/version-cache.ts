/** Shared cache primitive. Callers must authorize before reading it; a cache hit is never permission. */
export class StaleEntityRead extends Error {
    constructor() { super('STALE_ENTITY_READ'); }
}
type Entry<T> = {
    version: string;
    value: T;
    bytes: number;
};
type Slot = {
    version: string;
    token: object;
};
export class VersionCache<T> {
    readonly limitBytes: number;
    private entries = new Map<string, Entry<T>>();
    private slots = new Map<string, Slot>();
    private flights = new Map<string, {
        key: string;
        slot: Slot;
        promise: Promise<T>;
    }>();
    private bytes = 0;
    readonly counts = { hits: 0, misses: 0, loads: 0, evictions: 0 };
    constructor(limitBytes = 32 * 1024 * 1024) { if (!Number.isSafeInteger(limitBytes) || limitBytes < 0)
        throw Error('CACHE_LIMIT_INVALID'); this.limitBytes = limitBytes; }
    get usedBytes() { return this.bytes; }
    private remove(key: string) { const old = this.entries.get(key); if (old) {
        this.bytes -= old.bytes;
        this.entries.delete(key);
    } }
    invalidate(key: string) { this.remove(key); this.slots.delete(key); }
    clear() { this.entries.clear(); this.slots.clear(); this.bytes = 0; }
    async load(key: string, version: string, loader: () => Promise<T>): Promise<T> {
        const old = this.entries.get(key);
        if (old?.version === version) {
            this.counts.hits++;
            this.entries.delete(key);
            this.entries.set(key, old);
            return structuredClone(old.value);
        }
        this.counts.misses++;
        let slot = this.slots.get(key);
        if (!slot || slot.version !== version) {
            this.remove(key);
            slot = { version, token: {} };
            this.slots.set(key, slot);
        }
        const flightKey = JSON.stringify([key, version]), existing = this.flights.get(flightKey);
        if (existing?.slot === slot)
            return structuredClone(await existing.promise);
        const captured = slot;
        const promise = (async () => {
            this.counts.loads++;
            const value = await loader();
            if (this.slots.get(key) !== captured)
                throw new StaleEntityRead();
            const clone = structuredClone(value), bytes = 2 * JSON.stringify(clone).length + 2 * key.length + 2 * version.length + 256;
            if (bytes <= this.limitBytes) {
                this.remove(key);
                while (this.entries.size && this.bytes + bytes > this.limitBytes) {
                    const evicted = this.entries.keys().next().value!;
                    this.remove(evicted);
                    this.slots.delete(evicted);
                    this.counts.evictions++;
                }
                this.entries.set(key, { version, value: clone, bytes });
                this.bytes += bytes;
            }
            return clone;
        })();
        this.flights.set(flightKey, { key, slot: captured, promise });
        try {
            return structuredClone(await promise);
        }
        finally {
            if (this.flights.get(flightKey)?.slot === captured)
                this.flights.delete(flightKey);
            if (!this.entries.has(key) && ![...this.flights.values()].some(f => f.key === key) && this.slots.get(key) === captured)
                this.slots.delete(key);
        }
    }
}
