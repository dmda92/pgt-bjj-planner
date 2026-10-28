import {db} from '../infrastructure/local.ts';

/** Local recovery only. Never a remote write queue; authorization is checked by
 * the caller before exposing a draft. No tokens or passwords are stored here. */
export interface DraftRecord<T = unknown> {
    actor: string; owner: string; resource: string; data: T;
    base: string | null; baseData?: unknown; generation: number;
    editor?: string;
    /** Output-only: available in this page, not acknowledged by IndexedDB. */
    volatile?: boolean;
}
// A second tab must never overwrite or acknowledge the first tab's draft.
// sessionStorage survives reload/update and is independent between tabs.
const editor = typeof sessionStorage === 'undefined' ? 'local-test' :
    sessionStorage.getItem('pgt-draft-editor') || (() => {const id=crypto.randomUUID(); sessionStorage.setItem('pgt-draft-editor',id); return id;})();
let pending: Promise<unknown> = Promise.resolve();
const failures = new Map<string, unknown>();
const volatile = new Map<string,DraftRecord>();
const keyOf = (record: Pick<DraftRecord,'actor'|'owner'|'resource'|'editor'>) => JSON.stringify([record.actor,record.owner,record.resource,record.editor ?? editor]);
let reportedFailure = false;
class DraftConflict extends Error {}
function reportStorageStatus() {
    const failed = failures.size > 0;
    if (failed === reportedFailure) return;
    reportedFailure = failed;
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('pgt-draft-storage-status',{detail:{failed}}));
}
/** The in-page copy cannot survive a force kill when persistent storage fails. */
export function protectDraftUnload(event: Pick<BeforeUnloadEvent,'preventDefault'|'returnValue'>) {
    if (!volatile.size && !failures.size) return;
    event.preventDefault(); event.returnValue = '';
}
if (typeof window !== 'undefined') window.addEventListener('beforeunload',protectDraftUnload);
function serial<T>(key: string, action: () => Promise<T>): Promise<T> {
    const next = pending.then(action, action);
    pending = next.then(() => {if (!volatile.has(key)) failures.delete(key); reportStorageStatus();}, error => {if (!(error instanceof DraftConflict)) failures.set(key, error); reportStorageStatus();});
    return next;
}
export const draftJournal = {
    async get<T>(actor: string, owner: string, resource: string) {
        const key = keyOf({actor,owner,resource}), immediate = volatile.get(key);
        if (immediate && failures.has(key)) return {...structuredClone(immediate),volatile:true} as DraftRecord<T>;
        await pending;
        const copy = volatile.get(keyOf({actor,owner,resource}));
        if (copy) return {...structuredClone(copy),volatile:true} as DraftRecord<T>;
        return db.drafts.get([actor, owner, resource, editor]) as Promise<DraftRecord<T> | undefined>;
    },
    put<T>(draft: DraftRecord<T>) {
        const {volatile: _volatile,...data} = structuredClone(draft);
        const copy = {...data,editor};
        const key = keyOf(copy); volatile.set(key,copy);
        return serial(key, async () => {
            await db.drafts.put(copy);
            if (volatile.get(key) === copy) volatile.delete(key);
        });
    },
    remove(actor: string, owner: string, resource: string, generation?: number) {
        const memoryKey = keyOf({actor,owner,resource}), captured = volatile.get(memoryKey);
        return serial(memoryKey, async () => {
            let removed = false;
            await db.transaction('rw', db.drafts, async () => {
            const key: [string,string,string,string] = [actor,owner,resource,editor];
            const stored = await db.drafts.get(key), latest = volatile.get(memoryKey);
            if (latest && latest !== captured) return;
            const current = latest ?? stored;
            if (generation !== undefined && current && current.generation !== generation) return;
            await db.drafts.delete(key);
            removed = true;
            });
            if (removed && volatile.get(memoryKey) === captured) volatile.delete(memoryKey);
        });
    },
    async checkpoint() {await pending; if (failures.size || volatile.size) throw Error('No se pudo conservar el borrador en IndexedDB. Exporta una copia antes de cerrar o actualizar.');},
    async list(actor: string) {
        await pending;
        const copies = [...volatile.values()].filter(record => record.actor === actor);
        let stored: DraftRecord[];
        try { stored = await db.drafts.where('actor').equals(actor).toArray(); }
        catch (error) {if (!copies.length && ![...volatile.values()].some(record=>record.actor===actor)) throw error; stored = [];}
        const latest = [...volatile.values()].filter(record => record.actor === actor);
        return [...new Map([...stored,...[...copies,...latest].map(record=>({...record,volatile:true}))].map(record => [keyOf(record),structuredClone(record)])).values()];
    },
    isCurrent(record: DraftRecord) {return record.editor === editor;},
    recover(record: DraftRecord) {
        const memoryKey = keyOf(record), captured = volatile.get(memoryKey);
        return serial(memoryKey, async () => {
            await db.transaction('rw',db.drafts,async () => {
            const sourceKey: [string,string,string,string]=[record.actor,record.owner,record.resource,record.editor!];
            const source=volatile.get(memoryKey) ?? await db.drafts.get(sourceKey);
            if (volatile.get(memoryKey) !== captured) throw new DraftConflict('El borrador ha cambiado. Revisa la lista antes de recuperarlo.');
            if(!source || source.generation!==record.generation) throw new DraftConflict('El borrador ha cambiado. Revisa la lista antes de recuperarlo.');
            const targetKey: [string,string,string,string]=[record.actor,record.owner,record.resource,editor];
            if(source.editor!==editor && (volatile.has(keyOf({...record,editor})) || await db.drafts.get(targetKey))) throw new DraftConflict('Ya hay otro borrador abierto para este recurso. Resuélvelo antes de recuperar este.');
            await db.drafts.put({...source,editor});
            if (volatile.get(memoryKey) !== captured || source.editor!==editor && volatile.has(keyOf({...record,editor}))) throw new DraftConflict('El borrador ha cambiado. Revisa la lista antes de recuperarlo.');
            if(source.editor!==editor) await db.drafts.delete(sourceKey);
            });
            if (volatile.get(memoryKey) === captured) volatile.delete(memoryKey);
        });
    },
    discardRecord(record: DraftRecord) {
        const memoryKey = keyOf(record), captured = volatile.get(memoryKey);
        return serial(memoryKey,async()=> {
            await db.transaction('rw',db.drafts,async()=>{
            const key: [string,string,string,string]=[record.actor,record.owner,record.resource,record.editor!];
            const stored=volatile.get(memoryKey) ?? await db.drafts.get(key);
            if (volatile.get(memoryKey) !== captured) throw new DraftConflict('El borrador ha cambiado. Revisa la lista antes de descartarlo.');
            if(stored && stored.generation!==record.generation) throw new DraftConflict('El borrador ha cambiado. Revisa la lista antes de descartarlo.');
            await db.drafts.delete(key);
            });
            if (volatile.get(memoryKey) === captured) volatile.delete(memoryKey);
        });
    }
};
