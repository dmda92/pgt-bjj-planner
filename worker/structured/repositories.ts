import { ApiError, normalizedMail } from '../security.ts';
import { MAX_JSON_BYTES, documentFile } from '../../src/domain/json-limits.ts';
import type { PreflightEnv } from '../firestore-preflight.ts';
import type { Transport } from '../firestore-auth.ts';
import { NativeFirestore, revisionOf, reference, type NativeRow, fields, nativeDocumentBytes } from './firestore.ts';
export type EntityKind = 'user' | 'template' | 'techniques' | 'comments' | 'catalog' | 'assignment' | 'plan' | 'structure';
export type EntityRef = {
    kind: EntityKind;
    mail?: string;
    planId?: string;
};
export type EntityRecord<T = any> = {
    data: T;
    sha: string;
};
export type EntityEntry = {
    id: string;
    kind: EntityKind;
    sha?: string;
};
export type EntityScope = {
    kind: 'users';
} | {
    kind: 'versions' | 'plans';
    mail: string;
};
const uuid = (id: string) => { if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(id))
    throw new ApiError(400, 'ENTITY_ID_INVALID'); return id; };
const order = (a: NativeRow, b: NativeRow) => (a.data.ordinal ?? 0) - (b.data.ordinal ?? 0) || a.id.localeCompare(b.id);
const without = (data: any, keys: string[]) => Object.fromEntries(Object.entries(data).filter(([k]) => !keys.includes(k)));
const clean = (data: any): any => without(data, ['activeRevision', 'currentRevision', 'entityKind', 'entityCounts', 'publicationId', 'deleted', 'hasDescriptionUpdates', 'hasDeletionCatalog', 'hasCommentUpdates', 'hasContinuity', 'hasAppliedDescriptionUpdates', 'hasAppliedCommentUpdates', 'continuityCatalog', 'dayDictionary']);
const canonical = (v:any):string => JSON.stringify(v, (_key,value) => value && !Array.isArray(value) && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b))) : value);
const signatureFields = ['positionId', 'techniqueId', 'prioridad', 'pass', 'positionComplete'];
const encodeSignature = (value: string) => { try {
    const tuples = JSON.parse(value);
    if (Array.isArray(tuples) && tuples.every(v => Array.isArray(v) && v.length === 5))
        return { exerciseSignature: tuples.map(v => Object.fromEntries(signatureFields.map((k, i) => [k, v[i]]))) };
}
catch { } return { invalidLegacySignature: value }; };
const decodeSignature = (b: any) => b.exerciseSignature ? JSON.stringify(b.exerciseSignature.map((v: any) => signatureFields.map(k => v[k]))) : b.invalidLegacySignature;
const groups = (pending: any[]) => { const result: any[] = []; for (const p of pending) {
    let group = result.at(-1);
    if (group?.positionId !== p.positionId) {
        group = { positionId: p.positionId, techniqueIds: [], completeTechniqueIds: [] };
        result.push(group);
    }
    group.techniqueIds.push(p.techniqueId);
    if (p.complete)
        group.completeTechniqueIds.push(p.techniqueId);
} return result; };
const pending = (items: any[]) => items.flatMap(g => g.techniqueIds.map((id: string) => ({ positionId: g.positionId, techniqueId: id, complete: g.completeTechniqueIds.includes(id) })));
export class DomainRepositories {
    readonly db: NativeFirestore;
    private cache?: Map<string, Promise<EntityRecord | null>>;
    constructor(env: PreflightEnv, transport?: Transport) { this.db = new NativeFirestore(env, transport); }
    beginOperation() { this.cache = new Map(); this.db.beginOperation(); }
    endOperation() { this.cache = undefined; this.db.endOperation(); }
    async verifyTarget() { }
    path(ref: EntityRef) {
        const mail = ref.mail ? normalizedMail(ref.mail) : '';
        switch (ref.kind) {
            case 'user': return 'users/' + mail;
            case 'template': return 'technique_catalog/original';
            case 'techniques': return 'user_techniques/' + mail;
            case 'comments': return 'trainer_comments/' + mail;
            case 'catalog': return 'settings/competitions';
            case 'assignment': return 'user_plan_assignments/' + mail;
            case 'plan': return 'training_plans/' + uuid(ref.planId!) + '__' + mail;
            case 'structure': return 'training_day_indexes/' + uuid(ref.planId!) + '__' + mail;
        }
    }
    async read<T = any>(ref: EntityRef, fresh = false): Promise<EntityRecord<T> | null> {
        const path = this.path(ref);
        if(fresh){this.cache?.delete(path);this.db.invalidate(ref.kind==='catalog'?[path,'competitions','competition_tombstones']:[path]);}
        if (!fresh && this.cache?.has(path))
            return structuredClone(await this.cache.get(path)) as EntityRecord<T> | null;
        const load = this.load(ref);
        this.cache?.set(path, load);
        return structuredClone(await load) as EntityRecord<T> | null;
    }
    private async load(ref: EntityRef, attempt = 0): Promise<EntityRecord | null> {
        const path = this.path(ref), root = await this.db.get(path);
        if (!root || root.data.deleted)
            return null;
        if (ref.kind === 'catalog') {
            const rows = await this.db.list('competitions'), tombstones = await this.db.list('competition_tombstones'), map = new Map(rows.map(r => [r.id, r]));
            const ids = root.data.competitionIds || [];
            const after=await this.db.get(path,true);
            if(after?.updateTime!==root.updateTime){
                if(attempt>=2)throw new ApiError(409,'NATIVE_SNAPSHOT_CHANGED_RETRY');
                this.db.invalidate();return this.load(ref,attempt+1);
            }
            if (ids.some((id: string) => !map.has(id)))
                throw new ApiError(503, 'NATIVE_CATALOG_INCOMPLETE');
            return { data: { ...without(clean(root.data), ['competitionIds']), plans: ids.map((id: string) => map.get(id)!.data), deletedPlanIds: tombstones.sort(order).map(r => r.id) }, sha: await revisionOf(root.updateTime + ids.map((id: string) => map.get(id)!.updateTime).join('|')) };
        }
        const data = clean(root.data);
        if (ref.kind === 'user') {
            const credentials = await this.db.get(path + '/private/credentials');
            if (credentials)
                data.pwd = credentials.data.passwordHash;
            return { data, sha: await revisionOf(root.updateTime) };
        }
        if (ref.kind === 'assignment')
            return { data, sha: await revisionOf(root.updateTime) };
        const gen = String(root.data.activeRevision).split('/documents/')[1], tables: Record<string, NativeRow[]> = {};
        const children=gen?await this.db.children(gen):[];
        for(const name of Object.keys(root.data.entityCounts||{}))tables[name]=children.filter(row=>row.path.slice(gen.length+1).split('/')[0]===name).sort(order);
        // Children can now change atomically with their root. Bracket every
        // reconstruction, even when document counts happen to stay identical.
        const after = gen ? await this.db.get(path, true) : root;
        if (after?.updateTime !== root.updateTime) {
            if (attempt >= 2) throw new ApiError(409, 'NATIVE_SNAPSHOT_CHANGED_RETRY');
            this.db.invalidate();
            return this.load(ref, attempt + 1);
        }
        if (Object.entries(root.data.entityCounts || {}).some(([key, n]) => tables[key].length !== n))
            throw new ApiError(503, 'NATIVE_SNAPSHOT_INCOMPLETE');
        const values = (key: string): any[] => (tables[key] || []).map(r => without(r.data, ['ordinal']));
        const versions = (key: string) => root.data[({description_versions:'descriptionUpdates',comment_versions:'commentUpdates',applied_description_versions:'appliedDescriptionUpdates',applied_comment_versions:'appliedCommentUpdates'} as Record<string,string>)[key]] || Object.fromEntries((tables[key] || []).map(r => [r.id, r.data.value]));
        if (ref.kind === 'template' || ref.kind === 'techniques') {
            data.positions = (root.data.positions || values('positions')).map((p:any) => ({ ...p, tecnicas: values('techniques').filter(t => t.positionId === p.id).map(t => without(t, ['positionId','positionPriority'])) }));
            if (ref.kind === 'template')
                data.positions = data.positions.map((p: any) => without({ ...p, tecnicas: p.tecnicas.map((t: any) => without(t, ['id'])) }, ['id']));
            if (root.data.hasDescriptionUpdates)
                data.descriptionUpdates = versions('description_versions');
            if (root.data.hasDeletionCatalog)
                data.deletionCatalog = root.data.deletionCatalog || values('deletion_catalog');
        }
        else if (ref.kind === 'comments') {
            data.comments = root.data.comments || values('comments');
            if (root.data.hasCommentUpdates)
                data.commentUpdates = versions('comment_versions');
        }
        else if (ref.kind === 'plan') {
            data.sessions = values('sessions').map(s => ({ ...without(s,['continuityBoundary']), exercises: s.exercises || values('exercises').filter(e => e.sessionDate === s.date).map(e => without(e, ['sessionDate'])) }));
            if (root.data.hasContinuity)
                data.continuity = { version: 1, catalog: root.data.continuityCatalog || values('continuity_catalog'), boundaries: (values('sessions').some(s=>s.continuityBoundary) ? values('sessions').flatMap(s=>s.continuityBoundary?[s.continuityBoundary]:[]) : values('boundaries')).sort((a,b)=>(a.ordinal??0)-(b.ordinal??0)).map(b => ({ ...without(b, ['exerciseSignature', 'invalidLegacySignature','ordinal']), signature: decodeSignature(b), cursor: { priorities: b.cursor.priorities, priority: b.cursor.priority, move: b.cursor.move, passes: b.cursor.passes, pending: pending(b.cursor.remainingPositionGroups) } })) };
            if (root.data.hasAppliedDescriptionUpdates)
                data.appliedDescriptionUpdates = versions('applied_description_versions');
            if (root.data.hasAppliedCommentUpdates)
                data.appliedCommentUpdates = versions('applied_comment_versions');
        }
        else if (ref.kind === 'structure') {
            data.dictionary = (root.data.dayDictionary || values('dictionary')).map((r:any) => [r.posicion, r.tipo]);
            data.sessions = values('sessions');
        }
        return { data, sha: await revisionOf(root.updateTime) };
    }
    private documents(ref: EntityRef, data: any) {
        const tables: Record<string, {
            id: string;
            data: any;
        }[]> = {}, meta = { ...data };
        const table = (name: string, values: any[], id: (v: any, n: number) => string, convert = (v: any) => v) => tables[name] = values.map((v, n) => ({ id: id(v, n), data: { ...convert(v), ordinal: n } }));
        const map = (name: string, values: any) => table(name, Object.entries(values || {}), v => v[0], v => ({ value: v[1] }));
        if (ref.kind === 'template' || ref.kind === 'techniques') {
            const positions = data.positions.map((p: any, n: number) => ({ ...p, id: p.id || 'position-' + String(n + 1).padStart(3, '0') }));
            table('positions', positions, p => p.id, p => without(p, ['tecnicas']));
            const techniques = positions.flatMap((p: any) => p.tecnicas.map((t: any, n: number) => ({ ...t, id: t.id || p.id + '-technique-' + String(n + 1).padStart(3, '0'), positionId: p.id, positionPriority:p.prioridad, techniqueOrdinal: n })));
            table('techniques', techniques, t => t.id, t => ({ ...without(t, ['techniqueOrdinal']), ordinal: t.techniqueOrdinal }));
            // Order is local to each position: deleting a technique must not
            // renumber unrelated positions' documents.
            tables.techniques.forEach((row,n)=>row.data.ordinal=techniques[n].techniqueOrdinal);
            delete meta.positions;
            if ('descriptionUpdates' in data) {
                meta.hasDescriptionUpdates = true;
                map('description_versions', data.descriptionUpdates);
                delete meta.descriptionUpdates;
            }
            if ('deletionCatalog' in data) {
                meta.hasDeletionCatalog = true;
                table('deletion_catalog', data.deletionCatalog, p => p.id);
                delete meta.deletionCatalog;
            }
        }
        else if (ref.kind === 'comments') {
            table('comments', data.comments, c => c.techniqueId);
            delete meta.comments;
            if ('commentUpdates' in data) {
                meta.hasCommentUpdates = true;
                map('comment_versions', data.commentUpdates);
                delete meta.commentUpdates;
            }
        }
        else if (ref.kind === 'plan') {
            table('sessions', data.sessions, s => s.date, s => without(s, ['exercises']));
            table('exercises', data.sessions.flatMap((s: any) => s.exercises.map((e: any, n: number) => ({ ...e, sessionDate: s.date, exerciseOrdinal: n }))), e => e.sessionDate + '_' + String(e.exerciseOrdinal).padStart(3, '0'), e => without(e, ['exerciseOrdinal']));
            delete meta.sessions;
            if (data.continuity) {
                meta.hasContinuity = true;
                table('continuity_catalog', data.continuity.catalog, p => p.id);
                table('boundaries', data.continuity.boundaries, b => b.date, b => ({ ...without(b, ['signature']), ...encodeSignature(b.signature), cursor: { ...without(b.cursor, ['pending']), remainingPositionGroups: groups(b.cursor.pending) } }));
                delete meta.continuity;
            }
            if ('appliedDescriptionUpdates' in data) {
                meta.hasAppliedDescriptionUpdates = true;
                map('applied_description_versions', data.appliedDescriptionUpdates);
                delete meta.appliedDescriptionUpdates;
            }
            if ('appliedCommentUpdates' in data) {
                meta.hasAppliedCommentUpdates = true;
                map('applied_comment_versions', data.appliedCommentUpdates);
                delete meta.appliedCommentUpdates;
            }
        }
        else if (ref.kind === 'structure') {
            table('dictionary', data.dictionary, (_, n) => String(n).padStart(5, '0'), v => ({ posicion: v[0], tipo: v[1] }));
            table('sessions', data.sessions, s => s.date);
            delete meta.dictionary;
            delete meta.sessions;
        }
        // Bounded metadata belongs with its entity. Techniques remain queryable
        // documents; a training session is the natural atomic exercise unit.
        const small=(value:any)=>new TextEncoder().encode(JSON.stringify(value)).length<=96*1024;
        const inline=(tableName:string,fieldName:string,value:any)=>{if(small(value)){meta[fieldName]=value;delete tables[tableName];}};
        if(ref.kind==='template'||ref.kind==='techniques'){
            inline('positions','positions',(tables.positions||[]).map(row=>without(row.data,['ordinal'])));
            if('descriptionUpdates' in data)inline('description_versions','descriptionUpdates',data.descriptionUpdates);
            if('deletionCatalog' in data)inline('deletion_catalog','deletionCatalog',data.deletionCatalog);
        }
        if(ref.kind==='comments'){
            inline('comments','comments',data.comments);
            if('commentUpdates' in data)inline('comment_versions','commentUpdates',data.commentUpdates);
        }
        if(ref.kind==='structure')inline('dictionary','dayDictionary',(tables.dictionary||[]).map(row=>without(row.data,['ordinal'])));
        if(ref.kind==='plan'){
            if(data.continuity)inline('continuity_catalog','continuityCatalog',data.continuity.catalog);
            for(const [tableName,fieldName] of [['applied_description_versions','appliedDescriptionUpdates'],['applied_comment_versions','appliedCommentUpdates']])
                if(fieldName in data)inline(tableName,fieldName,data[fieldName]);
            const sessions=(tables.sessions||[]).map(row=>({...row,data:{...row.data,exercises:data.sessions.find((s:any)=>s.date===row.id).exercises,...(tables.boundaries?.find(b=>b.id===row.id)?{continuityBoundary:tables.boundaries.find(b=>b.id===row.id)!.data}:{})}}));
            if((tables.boundaries||[]).every(b=>sessions.some(s=>s.id===b.id)) && sessions.every(row=>new TextEncoder().encode(JSON.stringify(row.data)).length<=400*1024 && nativeDocumentBytes({name:'projects/pgt-bjj-dev/databases/(default)/documents/sessions/'+row.id,fields:fields(row.data)})<=800*1024)){
                tables.sessions=sessions;delete tables.exercises;delete tables.boundaries;
            }
        }
        return { meta, tables };
    }
    private event(ref: EntityRef, id: string) { return this.db.update('realtime_events/' + id, { owner: ref.mail || '', kind: ref.kind, version: id.replaceAll('-', '').padEnd(40, '0'), createdAt: new Date().toISOString() }, null); }
    async write(ref: EntityRef, data: any, expected: string | null): Promise<string> {
        const path = this.path(ref), root = await this.db.get(path, true), current = ref.kind === 'catalog' ? await this.read(ref, true) : root ? { sha: await revisionOf(root.updateTime) } : null;
        if ((current?.sha || null) !== expected)
            throw new ApiError(409, 'VERSION_CONFLICT');
        const bytes = new TextEncoder().encode(JSON.stringify(data)).length;
        if (bytes > MAX_JSON_BYTES)
            throw new ApiError(413, 'JSON_TOO_LARGE', undefined, { file: this.errorName(ref), bytes, limitBytes: MAX_JSON_BYTES, scope: 'document', exact: true });
        if(root && ['user','assignment'].includes(ref.kind)){
            const existing=await this.read(ref,true);
            if(existing?.sha!==expected)throw new ApiError(409,'VERSION_CONFLICT');
            if(existing && canonical(existing.data)===canonical(data))return expected!;
        }
        const id = crypto.randomUUID();
        let newGeneration: string | undefined;
        try {
            if (ref.kind === 'catalog') {
                const existing = await this.db.list('competitions'), tombstones = await this.db.list('competition_tombstones'), byId = new Map(existing.map(r => [r.id, r])), ids = new Set(data.plans.map((p: any) => p.planId));
                const writes = data.plans.filter((p: any) => JSON.stringify(byId.get(p.planId)?.data) !== JSON.stringify(p)).map((p: any) => this.db.update('competitions/' + uuid(p.planId), p, byId.get(p.planId) || null));
                writes.push(...existing.filter(r => !ids.has(r.id)).map(r => this.db.deletion(r)));
                const deleted = new Set(data.deletedPlanIds);
                for (let ordinal = 0; ordinal < data.deletedPlanIds.length; ordinal++) {
                    const id = data.deletedPlanIds[ordinal], prior = tombstones.find(r => r.id === id);
                    if (!prior || prior.data.ordinal !== ordinal)
                        writes.push(this.db.update('competition_tombstones/' + uuid(id), { planId: id, ordinal }, prior || null));
                }
                writes.push(...tombstones.filter(r => !deleted.has(r.id)).map(r => this.db.deletion(r)));
                for (const p of data.plans.filter((p: any) => !byId.has(p.planId))) {
                    const runs = p.alumnos.map((m: string) => m.match(/^pgt-dev-([0-9a-f-]{36})-(?:trainer|student|other)@example\.test$/)?.[1]);
                    if (runs.length && runs.every((r: string) => r && r === runs[0])) {
                        const marker = await this.db.get('qa_runs/' + runs[0]);
                        if (marker?.data.purpose === 'isolated_browser_qa')
                            writes.push(this.db.update(marker.path, { ...marker.data, competitionIds: [...new Set([...(marker.data.competitionIds || []), p.planId])] }, marker));
                    }
                }
                await this.db.commit([...writes, this.db.update(path, { ...without(data, ['plans', 'deletedPlanIds']), competitionIds: data.plans.map((p: any) => p.planId), publicationId: id }, root), this.event(ref, id)]);
            }
            else if (ref.kind === 'user') {
                const credentials = await this.db.get(path + '/private/credentials');
                await this.db.commit([this.db.update(path, { ...without(data, ['pwd']), entityKind: 'user', publicationId: id }, root), ...(data.pwd && credentials?.data.passwordHash!==data.pwd ? [this.db.update(path + '/private/credentials', { passwordHash: data.pwd }, credentials)] : []), this.event(ref, id)]);
            }
            else if (ref.kind === 'assignment')
                await this.db.commit([this.db.update(path, { ...data, entityKind: ref.kind, publicationId: id }, root), this.event(ref, id)]);
            else {
                const { meta, tables } = this.documents(ref, data);
                const active = root?.data.activeRevision ? String(root.data.activeRevision).split('/documents/')[1] : undefined;
                const prior = active ? await this.db.children(active) : [];
                const byPath = new Map(prior.map(row=>[row.path,row]));
                const desired = Object.entries(tables).flatMap(([name,rows])=>rows.map(row=>({path:active+'/'+name+'/'+row.id,data:row.data})));
                const paths = new Set(desired.map(row=>row.path));
                const delta = active ? [
                    ...desired.filter(row=>canonical(byPath.get(row.path)?.data)!==canonical(row.data)).map(row=>this.db.update(row.path,row.data,byPath.get(row.path)||null)),
                    ...prior.filter(row=>!paths.has(row.path)).map(row=>this.db.deletion(row))
                ] : [];
                const rootData = {...meta,entityKind:ref.kind,entityCounts:Object.fromEntries(Object.entries(tables).map(([k,v])=>[k,v.length]))};
                const unchanged = root && (active ? !delta.length : !Object.values(tables).some(rows=>rows.length)) && canonical(without(root!.data,['activeRevision','publicationId']))===canonical(rootData);
                if(unchanged)return expected!;
                if(!Object.values(tables).some(rows=>rows.length) && !active){
                    await this.db.commit([this.db.update(path,{...rootData,publicationId:id},root),...(ref.kind==='structure'?[]:[this.event(ref,id)])]);
                }else{
                const atomic = active ? [...delta,this.db.update(path,{...rootData,activeRevision:reference(active),publicationId:id},root),...(ref.kind==='structure'?[]:[this.event(ref,id)])] : [];
                if(active && atomic.length<=450 && new TextEncoder().encode(JSON.stringify({writes:atomic})).length<=8*1024*1024){
                    await this.db.commit(atomic);
                }else{
                    const gen=path+'/revisions/'+id;
                    newGeneration=gen;
                    const writes=[this.db.update(gen,{createdAt:new Date().toISOString(),entityKind:ref.kind},null),...Object.entries(tables).flatMap(([name,rows])=>rows.map(row=>this.db.update(gen+'/'+name+'/'+row.id,row.data,null)))];
                    await this.db.commitChunks(writes);
                    await this.db.commit([this.db.update(path,{...rootData,activeRevision:reference(gen),publicationId:id},root),...(ref.kind==='structure'?[]:[this.event(ref,id)]),...(active?[this.db.update('revision_cleanup/'+id,{entityPath:path,revisionPath:active,createdAt:new Date().toISOString()},null)]:[])]);
                }
                }
            }
        }
        catch (e) {
            let winner: NativeRow | null;
            try { winner = await this.db.get(path, true); }
            catch { this.cache?.delete(path); throw e; } // An uncertain publication must never delete its possibly active revision.
            if (winner?.data.publicationId !== id) {
                if (newGeneration)
                    await this.removeGeneration(newGeneration).catch(() => { });
                this.cache?.delete(path);
                throw e;
            }
        }
        this.cache?.delete(path);
        const saved = this.db.committed(path) || await this.db.get(path);
        if (!saved || saved.data.publicationId !== id)
            throw new ApiError(409, 'VERSION_CONFLICT');
        if (newGeneration && root?.data.activeRevision) {
            try { await this.collectRetired(id); }
            catch { console.warn('PGT_REVISION_CLEANUP_PENDING'); }
        }
        const result = ref.kind === 'catalog' ? await this.read(ref, true) : { data: structuredClone(data), sha: await revisionOf(saved.updateTime) };
        if (!result)
            throw new ApiError(503, 'NATIVE_WRITE_NOT_CONFIRMED');
        this.cache?.set(path, Promise.resolve(result));
        return result.sha;
    }
    async collectRetired(id?:string) {
        const jobs=id?[await this.db.get('revision_cleanup/'+id)]:await this.db.query('revision_cleanup',undefined,undefined,4);
        for(const job of jobs.filter(Boolean).slice(0,4)){
            const entityPath=job!.data.entityPath,revisionPath=job!.data.revisionPath;
            if(typeof entityPath!=='string'||typeof revisionPath!=='string'||!revisionPath.startsWith(entityPath+'/revisions/')||revisionPath.split('/').length!==4)throw new ApiError(500,'REVISION_CLEANUP_INVALID');
            const active=await this.db.get(entityPath,true);
            if(active?.data.activeRevision===('projects/pgt-bjj-dev/databases/(default)/documents/'+revisionPath))continue;
            await this.removeGeneration(revisionPath);await this.db.deleteRows([job!]);
        }
    }
    errorName(ref: EntityRef) { return ref.kind === 'plan' ? 'plan_' + ref.planId + '.json' : ref.kind === 'techniques' ? 'tecnics.json' : ref.kind === 'comments' ? 'trainer_comments.json' : ref.kind === 'catalog' ? 'plans.json' : 'user_data.json'; }
    async remove(ref: EntityRef, expected: string) { const path = this.path(ref), root = await this.db.get(path), current = await this.read(ref, true); if (!root || current?.sha !== expected)
        throw new ApiError(409, 'VERSION_CONFLICT'); await this.db.commit([this.db.update(path, { ...root.data, deleted: true }, root), this.event(ref, crypto.randomUUID())]); this.cache?.delete(path); await this.finishRemoval(ref); }
    private async finishRemoval(ref: EntityRef) { const path = this.path(ref), root = await this.db.get(path); if (root && !root.data.deleted)
        throw new ApiError(409, 'ENTITY_NOT_MARKED_FOR_DELETION'); for (const rev of await this.db.list(path + '/revisions'))
        await this.removeGeneration(rev.path); const credentials = ref.kind === 'user' ? await this.db.get(path + '/private/credentials') : null; await this.db.deleteRows([...(root ? [root] : []), ...(credentials ? [credentials] : [])]); this.cache?.delete(path); }
    async cleanupEntity(ref: EntityRef) { const root = await this.db.get(this.path(ref)); if (root?.data.deleted || !root) {
        await this.finishRemoval(ref);
        return;
    } const prior = await this.read(ref, true); if (prior)
        await this.remove(ref, prior.sha); }
    async removeGeneration(path: string) { const rows = await this.db.children(path); const generation = await this.db.get(path); if (generation)
        rows.push(generation); await this.db.deleteRows(rows); }
    async profiles(){return (await this.db.list('users')).filter(row=>!row.data.deleted&&!row.data.probeOnly).map(row=>({data:clean(row.data),updateTime:row.updateTime}));}
    async list(scope: EntityScope): Promise<EntityEntry[]> {
        if (scope.kind === 'users')
            return (await this.db.list('users')).filter(r => !r.data.deleted).map(r => ({ id: r.id, kind: 'user' as const })).sort((a, b) => a.id.localeCompare(b.id));
        if (scope.kind === 'plans') {
            const rows = await Promise.all(['plan', 'structure'].map(async (kind) => { const entries = await this.db.query(kind === 'plan' ? 'training_plans' : 'training_day_indexes', 'mail', scope.mail); return Promise.all(entries.map(async (r) => ({ id: r.data.planId, kind: kind as EntityKind, sha: await revisionOf(r.updateTime) }))); }));
            return rows.flat().sort((a, b) => a.id.localeCompare(b.id) || a.kind.localeCompare(b.kind));
        }
        const kinds: EntityKind[] = ['user', 'techniques', 'comments', 'assignment'];
        return (await Promise.all(kinds.map(async (kind) => { const root = await this.db.get(this.path({ kind, mail: scope.mail })); return root ? { id: kind, kind, sha: await revisionOf(root.updateTime) } : null; }))).filter(r => r !== null) as EntityEntry[];
    }
    async changes() { return (await this.db.query('realtime_events',undefined,undefined,100)).map(r => ({ name: r.path, updateTime: r.updateTime, owner: r.data.owner, kind: r.data.kind, version: r.data.version })); }
    async acknowledge(changes: {
        name: string;
        updateTime: string;
    }[]) { await this.db.deleteRows(changes.map(r => ({ path: r.name, updateTime: r.updateTime, exists: true } as NativeRow))); }
}
