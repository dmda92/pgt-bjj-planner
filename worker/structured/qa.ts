import { ApiError, passwordHash } from '../security.ts';
import { initialVersion, cloneTemplate, type Profile, type Template, type Catalog } from '../../src/domain/models.ts';
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
        await repo.write({ kind: 'catalog' }, { ...catalog.data, revision: catalog.data.revision + 1, updatedAt: new Date().toISOString(), plans: catalog.data.plans.filter(c => !ids.has(c.planId)), deletedPlanIds: catalog.data.deletedPlanIds.filter(id => !ids.has(id)) }, catalog.sha);
    }
    let tasks = marker.data.pending as EntityRef[] | undefined;
    if (!tasks) {
        tasks = [];
        for (const mail of mails) {
            for (const p of await repo.list({ kind: 'plans', mail }))
                tasks.push({ kind: p.kind, mail, planId: p.id });
            for (const kind of ['techniques', 'comments', 'assignment', 'user'] as const)
                tasks.push({ kind, mail });
        }
    }
    if (tasks.length) {
        const ref = tasks.shift()!;
        await repo.cleanupEntity(ref);
        await repo.db.commit([repo.db.update(marker.path, { ...marker.data, pending: tasks, cleaning: true }, marker)]);
        return { status: 'SYNTHETIC_FIXTURE_CLEANING', remaining: tasks.length };
    }
    await repo.db.deleteRows([marker]);
    return { status: 'SYNTHETIC_FIXTURE_CLEANED', resources: marker.data.resources || 12 };
}
