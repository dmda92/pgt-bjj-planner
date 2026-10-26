import { createHash } from 'node:crypto';
import { verifyBundle, type MigrationBundle } from './convert.ts';
import { NativeAggregates } from '../../worker/v2/aggregates.ts';
import { PlanRepository, nativeWrite } from '../../worker/v2/plans.ts';
import { NativeFirestore } from '../../worker/structured/firestore.ts';
import { decodePlan } from '../../src/infrastructure/plan-codec.ts';
import { blockDigest } from '../../src/infrastructure/native-packing.ts';
import { buildMonthlyAgenda } from '../../src/infrastructure/trainer-agenda.ts';
import { validateProfile, validatePlan, type TrainingPlan } from '../../src/domain/models.ts';
import { SOURCE_REPOSITORY } from './github-source.ts';
const operationId = (key: string) => { const h = createHash('sha256').update(key).digest('hex').slice(0, 32); return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20); };
export interface StagingResult {
    namespace: string;
    status: 'verified-staging';
    users: number;
    plans: number;
    months: number;
    active: false;
}
function prepare(bundle: MigrationBundle) {
    verifyBundle(bundle);
    if (bundle.target !== 'pgt-bjj-dev')
        throw Error('MIGRATION_PRODUCTION_STAGING_NOT_ENABLED');
    if (bundle.source.repository !== SOURCE_REPOSITORY || !/^[0-9a-f]{40}$/.test(bundle.source.commit))
        throw Error('MIGRATION_SOURCE_INVALID');
    if (!bundle.ready || bundle.issues.some(i => i.blocking))
        throw Error('MIGRATION_SOURCE_REQUIRES_REVIEW');
    if (!bundle.template || !bundle.catalog)
        throw Error('MIGRATION_SOURCE_INCOMPLETE');
    const users = new Set<string>();
    for (const u of bundle.users) {
        validateProfile(u.profile);
        if (users.has(u.profile.mail) || u.credential.state !== 'requires-dev-password' || !u.techniques || !u.comments || !u.index)
            throw Error('MIGRATION_DEV_ACCOUNT_INVALID');
        users.add(u.profile.mail);
    }
    const plans: TrainingPlan[] = [], ids = new Set<string>();
    for (const item of bundle.plans) {
        const p = decodePlan(item.plan);
        validatePlan(p);
        const identity = p.planId + '__' + p.mail;
        if (ids.has(identity) || !users.has(p.mail) || p.mail !== item.text.metadata.mail || p.planId !== item.text.metadata.planId)
            throw Error('MIGRATION_PLAN_IDENTITY_INVALID');
        ids.add(identity);
        plans.push(p);
    }
    const namespace = 'pgt_v2/import-' + bundle.checksum.slice(0, 24);
    const missingMonths: string[] = [];
    for (const c of bundle.catalog.plans) if (c.alumnos.some(owner => !plans.some(p => p.mail === owner && p.planId === c.planId))) {
        const cursor = new Date(c.fecha_comienzo.slice(0, 7) + '-01T12:00:00Z');
        while (cursor.toISOString().slice(0, 10) < c.fecha_torneo) { missingMonths.push(cursor.toISOString().slice(0, 7)); cursor.setUTCMonth(cursor.getUTCMonth() + 1); }
    }
    const months = [...new Set([...plans.flatMap(p => p.sessions.map(s => s.date.slice(0, 7))), ...missingMonths])].sort();
    return { namespace, plans, months };
}
/** Staging only: never activates a dataset, deletes old data or contacts GitHub.
 * The caller must provide the budgeted DEV transport; no default network capability exists here.
 */
export async function stageMigration(bundle: MigrationBundle, db: NativeFirestore): Promise<StagingResult> {
    const { namespace, plans, months } = prepare(bundle);
    if (!db.usage.budget)
        throw Error('MIGRATION_EXPLICIT_BUDGET_REQUIRED');
    const existing = await db.get(namespace, true);
    if (existing && (existing.data.bundleChecksum !== bundle.checksum || existing.data.active !== false))
        throw Error('MIGRATION_STAGING_CONFLICT');
    const result: StagingResult = { namespace, status: 'verified-staging', users: bundle.users.length, plans: plans.length, months: months.length, active: false };
    if (existing?.data.phase === 'verified')
        return result;
    if (!existing) {
        await db.commit([nativeWrite(db, namespace, { format: 'pgt-import-v2', target: bundle.target, bundleChecksum: bundle.checksum,
                sourceCommit: bundle.source.commit, sourceChecksum: bundle.source.checksum, phase: 'staging', active: false }, null)]);
    }
    const sources = new NativeAggregates(db, namespace), planStore = new PlanRepository(db, namespace), prefix = bundle.checksum + ':';
    const write = async (kind: Parameters<NativeAggregates['write']>[0]['kind'], id: string, data: unknown) => {
        await sources.write({ kind, id }, data, null, operationId(prefix + kind + ':' + id));
    };
    await write('template', 'official', bundle.template);
    await write('catalog', 'competitions', bundle.catalog);
    const indexFor = (u: MigrationBundle['users'][number]) => {
        const pending = u.index!.planIds.filter(id => !plans.some(p => p.mail === u.profile.mail && p.planId === id));
        return { ...u.index!, ...(pending.length ? { pendingPlanIds: pending } : {}) };
    };
    for (const u of bundle.users) {
        await write('profile', u.profile.mail, u.profile);
        await write('repertoire', u.profile.mail, u.techniques);
        await write('comments', u.profile.mail, u.comments);
        await write('assignment', u.profile.mail, indexFor(u));
    }
    const roster = bundle.users.map(u => ({ mail: u.profile.mail, nombre: u.profile.nombre, apellidos: u.profile.apellidos, perfil: u.profile.perfil, cinturon: u.profile.cinturon }));
    await write('roster', 'users', { users: roster });
    for (const [i, p] of plans.entries()) {
        await planStore.write(p, null, operationId(prefix + 'plan:' + p.planId + ':' + p.mail));
        await write('plan-text', p.planId + '__' + p.mail, bundle.plans[i].text);
    }
    const missing = (bundle.catalog!.plans.flatMap(c => c.alumnos.filter(mail => !plans.some(p => p.mail === mail && p.planId === c.planId))
        .map(owner => ({ owner, planId: c.planId, start: c.fecha_comienzo, end: c.fecha_torneo }))));
    for (const month of months)
        await write('agenda', month, buildMonthlyAgenda(plans, month, missing));
    await write('agenda', 'calendar', { months });
    // Deliberately discard receipts/read cache before verification: checking an ACK in
    // memory is not independent verification of what the destination persisted.
    db.endOperation();
    db.beginOperation();
    const compare = async (kind: Parameters<NativeAggregates['read']>[0]['kind'], id: string, expected: unknown) => {
        const actual = await sources.read({ kind, id });
        if (!actual || blockDigest(actual.data) !== blockDigest(expected))
            throw Error('MIGRATION_DESTINATION_MISMATCH');
    };
    await compare('template', 'official', bundle.template);
    await compare('catalog', 'competitions', bundle.catalog);
    for (const u of bundle.users) {
        await compare('profile', u.profile.mail, u.profile);
        await compare('repertoire', u.profile.mail, u.techniques);
        await compare('comments', u.profile.mail, u.comments);
        await compare('assignment', u.profile.mail, indexFor(u));
    }
    await compare('roster', 'users', { users: roster });
    for (const [i, p] of plans.entries()) {
        const actual = await planStore.read(p.mail, p.planId);
        if (!actual || blockDigest(actual.data) !== blockDigest(p))
            throw Error('MIGRATION_PLAN_MISMATCH');
        await compare('plan-text', p.planId + '__' + p.mail, bundle.plans[i].text);
    }
    for (const month of months)
        await compare('agenda', month, buildMonthlyAgenda(plans, month, missing));
    await compare('agenda', 'calendar', { months });
    const head = await db.get(namespace, true);
    if (!head || head.data.bundleChecksum !== bundle.checksum || head.data.active !== false)
        throw Error('MIGRATION_STAGING_CONFLICT');
    await db.commit([nativeWrite(db, namespace, { ...head.data, phase: 'verified', counts: { users: result.users, plans: result.plans, months: result.months } }, head)]);
    return result;
}
