import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import type { BudgetKV, BudgetStorage } from '../../worker/structured/execution-budget.ts';
const localQueues = new Map<string, Promise<unknown>>();

/** Private operator ledger. Every local executor for DEV must use this same
 * database; BEGIN IMMEDIATE serializes separate processes, not just JS tasks. */
export class LocalMigrationLedger implements BudgetStorage {
    private db: DatabaseSync;
    private filename: string;
    constructor(filename: string) {
        this.filename = resolve(filename);
        this.db = new DatabaseSync(filename, { timeout: 15000 });
        this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS migration_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    }
    transaction<T>(fn: (store: BudgetKV) => Promise<T>): Promise<T> {
        // SQLite's busy wait is synchronous: avoid blocking another connection's
        // pending JS continuation when both executors live in this same process.
        const result = (localQueues.get(this.filename) ?? Promise.resolve()).then(async () => {
            this.db.exec('BEGIN IMMEDIATE');
            try {
                const value = await fn({
                    get: async <V>(key: string) => {
                        const row = this.db.prepare('SELECT value FROM migration_kv WHERE key=?').get(key);
                        return row ? JSON.parse(String(row.value)) as V : undefined;
                    },
                    put: async (key, value) => { this.db.prepare('INSERT INTO migration_kv VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value)); }
                });
                this.db.exec('COMMIT'); return value;
            } catch (error) { this.db.exec('ROLLBACK'); throw error; }
        });
        localQueues.set(this.filename, result.catch(() => undefined));
        return result;
    }
    close() { this.db.close(); }
}
