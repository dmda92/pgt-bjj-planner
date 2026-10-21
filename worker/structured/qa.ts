import { ApiError, passwordHash, passwordMatches } from '../security.ts';
import { initialVersion, cloneTemplate, type Profile, type Template, type Catalog, type Index } from '../../src/domain/models.ts';
import { DomainRepositories, type EntityRef } from './repositories.ts';
export async function seedStructuredQA(repo: DomainRepositories, runId: string, password: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(runId) || password.length < 24 || password.length > 100)
        throw new ApiError(400, 'SYNTHETIC_FIXTURE_INVALID');
    const source = await repo.read<Template>({ kind: 'template' });
    if (!source)
        throw new ApiError(503, 'ORIGINAL_CATALOG_REQUIRED');
    let marker = await repo.db.get('qa_runs/' + runId);
    if (!marker) {
        await repo.db.commit([repo.db.update('qa_runs/' + runId, { purpose: 'isolated_browser_qa', createdAt: new Date().toISOString(), seededRoles: [] }, null)]);
        marker = (await repo.db.get('qa_runs/' + runId))!;
    }
    if (marker.data.purpose !== 'isolated_browser_qa' || marker.data.seedComplete)
        throw new ApiError(409, 'SYNTHETIC_RUN_ALREADY_EXISTS');
    const roles = ['trainer', 'student'] as const, seeded = marker.data.seededRoles as string[], role = roles.find(r => !seeded.includes(r));
    if (role) {
        const pwd = await passwordHash(password), mail = `pgt-dev-${runId}-${role}@example.test`, ref = { kind: 'user' as const, mail };
        if (await repo.read(ref))
            throw new ApiError(409, 'SYNTHETIC_RUN_ALREADY_EXISTS');
        const p: Profile = { ...initialVersion(), mail, nombre: role === 'trainer' ? 'Entrenador de prueba' : role === 'student' ? 'Alumno de prueba' : 'Otro alumno de prueba', apellidos: runId.slice(0, 8), fecha_nacimiento: null, peso: null, cinturon: 'Blanco', perfil: role === 'trainer' ? 'entrenador' : 'alumno', pwd };
        await repo.write(ref, p, null);
        await repo.write({ kind: 'techniques', mail }, cloneTemplate(source.data), null);
        await repo.write({ kind: 'comments', mail }, { ...initialVersion(), comments: [] }, null);
        await repo.write({ kind: 'assignment', mail }, { ...initialVersion(), planIds: [] }, null);
        seeded.push(role);
        await repo.db.commit([repo.db.update(marker.path, { ...marker.data, seededRoles: seeded, seedComplete: seeded.length === 2 }, marker)]);
    }
    const schema = await repo.db.get('settings/schema');
    return { catalogStructureChecksum: schema?.data.structureChecksum, runId, users: (['trainer', 'student', 'other'] as const).map(role => ({ mail: `pgt-dev-${runId}-${role}@example.test`, role: role === 'trainer' ? 'entrenador' : 'alumno' })), status: seeded.length === 2 ? 'SYNTHETIC_FIXTURE_CREATED' : 'SYNTHETIC_FIXTURE_CREATING', template: 'ORIGINAL_REFERENCE_CATALOG' };
}
export async function cleanStructuredQA(repo: DomainRepositories, runId: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(runId))
        throw new ApiError(400, 'SYNTHETIC_FIXTURE_INVALID');
    const marker = await repo.db.get('qa_runs/' + runId);
    if (!marker || marker.data.purpose !== 'isolated_browser_qa')
        throw new ApiError(403, 'SYNTHETIC_RUN_REQUIRED');
    const mails = ['trainer', 'student', 'other'].map(role => `pgt-dev-${runId}-${role}@example.test`), catalog = await repo.read<Catalog>({ kind: 'catalog' });
    if (catalog && !marker.data.cleaning) {
        const owned = catalog.data.plans.filter(c => c.alumnos.some(m => mails.includes(m)));
        if (owned.some(c => c.alumnos.some(m => !mails.includes(m))))
            throw new ApiError(409, 'SYNTHETIC_SHARED_PLAN_NOT_CLEANED');
        const ids = new Set([...(marker.data.competitionIds || []), ...owned.map(c => c.planId)]);
        if (catalog.data.plans.some(c => ids.has(c.planId) && c.alumnos.some(m => !mails.includes(m))))
            throw new ApiError(409, 'SYNTHETIC_SHARED_PLAN_NOT_CLEANED');
        if(catalog.data.plans.some(c=>ids.has(c.planId))||catalog.data.deletedPlanIds.some(id=>ids.has(id)))
        await repo.write({ kind: 'catalog' }, { ...catalog.data, revision: catalog.data.revision + 1, updatedAt: new Date().toISOString(), plans: catalog.data.plans.filter(c => !ids.has(c.planId)), deletedPlanIds: catalog.data.deletedPlanIds.filter(id => !ids.has(id)) }, catalog.sha);
    }
    let tasks = marker.data.pending as EntityRef[] | undefined;
    if (!tasks) {
        tasks = [];
        const knownPlanIds = new Set<string>(marker.data.competitionIds || []);
        for (const mail of mails) {
            for (const p of await repo.list({ kind: 'plans', mail }))
                tasks.push({ kind: p.kind, mail, planId: p.id });
            for (const planId of knownPlanIds)
                for (const kind of ['plan', 'structure'] as const)
                    if (!tasks.some(ref => ref.kind === kind && ref.mail === mail && ref.planId === planId))
                        tasks.push({ kind, mail, planId });
            for (const kind of ['techniques', 'comments', 'assignment', 'user'] as const)
                tasks.push({ kind, mail });
        }
    }
    if (tasks.length) {
        const ref = tasks.shift()!;
        await repo.cleanupEntity(ref);
        await repo.db.commit([repo.db.update(marker.path, { ...marker.data, pending: tasks, cleaning: true, resources: marker.data.resources || tasks.length + 1 }, marker)]);
        return { status: 'SYNTHETIC_FIXTURE_CLEANING', remaining: tasks.length };
    }
    // A global deletion can project a QA tombstone into an unrelated user's
    // index. Remove only IDs proven to belong to this run; preserve all others.
    const ownedIds=new Set<string>(marker.data.competitionIds||[]);
    if(ownedIds.size)for(const row of await repo.db.list('user_plan_assignments')){
        if(mails.includes(row.id))continue;
        const ref={kind:'assignment' as const,mail:row.id},current=await repo.read<Index>(ref,true);
        if(!current)continue;
        if(current.data.planIds.some(id=>ownedIds.has(id)))throw new ApiError(409,'SYNTHETIC_SHARED_PLAN_NOT_CLEANED');
        const deleted=current.data.deletedPlanIds||[];
        if(deleted.some(id=>ownedIds.has(id))){
            await repo.write(ref,{...current.data,revision:current.data.revision+1,updatedAt:new Date().toISOString(),deletedPlanIds:deleted.filter(id=>!ownedIds.has(id))},current.sha);
            return {status:'SYNTHETIC_FIXTURE_CLEANING',remaining:0};
        }
    }
    await repo.db.deleteRows([marker]);
    return { status: 'SYNTHETIC_FIXTURE_CLEANED', resources: marker.data.resources || 12 };
}

/** Deployment-authenticated and restricted to the current synthetic run.
 * Report booleans only, never a password, salt, hash or account contents. */
export async function checkStructuredQA(repo:DomainRepositories,runId:string,password:string){
    if(!/^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(runId)||password.length<24||password.length>100)throw new ApiError(400,'SYNTHETIC_FIXTURE_INVALID');
    const marker=await repo.db.get('qa_runs/'+runId,true);
    if(marker?.data.purpose!=='isolated_browser_qa'||!marker.data.seedComplete||marker.data.cleaning)throw new ApiError(403,'SYNTHETIC_RUN_REQUIRED');
    const users=[];
    for(const role of ['trainer','student'] as const){
        const mail=`pgt-dev-${runId}-${role}@example.test`,profile=await repo.db.get('users/'+mail,true),credentials=await repo.db.get('users/'+mail+'/private/credentials',true);
        const hash=credentials?.data.passwordHash,hashFormatValid=typeof hash==='string'&&/^pbkdf2-sha256\$600000\$[A-Za-z0-9_-]{43}\$[A-Za-z0-9+/]{43}=$/.test(hash);
        const restored=await repo.read<Profile>({kind:'user',mail},true);
        users.push({role,profileExists:!!profile,credentialsExist:!!credentials,hashFormatValid,repositoryRestoresHash:!!hash&&restored?.data.pwd===hash,passwordMatches:hashFormatValid&&await passwordMatches(password,hash),profileRoleCorrect:profile?.data.perfil===(role==='trainer'?'entrenador':'alumno')});
    }
    return {status:'SYNTHETIC_CREDENTIALS_CHECKED',users};
}
