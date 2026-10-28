import { ApiError, normalizedMail, onlyFields, opaqueToken } from '../security.ts';
import { initialVersion, validateTechniques, validateCompetition, type Techniques, type Comments, type Catalog, type Competition, type TrainingPlan, type Profile } from '../../src/domain/models.ts';
import { MAX_JSON_BYTES, MAX_TEXT_LENGTH, jsonBytes } from '../../src/domain/json-limits.ts';
import { catalogOf, deletedUUIDs } from '../../src/domain/plan-continuity.ts';
import { hasTrainableAdditions, updateFutureStructure, type AdditionTechniques, type AdditionPlan } from '../../src/domain/plan-additions.ts';
import { descriptionChanges, commentChanges, updateTextVersions, madridDate, updateFuturePlanText } from '../../src/domain/plan-text-updates.ts';
import { updateFuturePlanLabels } from '../../src/domain/plan-labels.ts';
import { generatePlan } from '../../src/domain/planner.ts';
import { indexPlanText, projectPlanText, updateProjectionMetadata, ProjectedPlanTooLarge, type PlanTextProjection } from '../../src/infrastructure/plan-text-projection.ts';
import { buildMonthlyAgenda, replaceAgendaPlan, type MonthlyAgenda } from '../../src/infrastructure/trainer-agenda.ts';
import { blockDigest } from '../../src/infrastructure/native-packing.ts';
import { QueryCoordinator, type QuerySession, type EntityReader, type PlanChange } from './query-coordinator.ts';
import { PlanViews } from './plan-views.ts';
import type { AggregateChange } from './aggregates.ts';
import type { AssignmentState } from './text-commands.ts';

type AgendaEdits = Map<string, { data: MonthlyAgenda; expected: string | null }>;
const trainable = (t: Techniques) => t.positions.some(p => p.tecnicas.length);
const monthsOf = (c: Competition) => {
    const result: string[] = [], cursor = new Date(c.fecha_comienzo.slice(0, 7) + '-01T12:00:00Z');
    while (cursor.toISOString().slice(0, 10) < c.fecha_torneo) { result.push(cursor.toISOString().slice(0, 7)); cursor.setUTCMonth(cursor.getUTCMonth() + 1); }
    return result;
};
const refText = (owner: string, id: string) => ({ kind: 'plan-text' as const, id: id + '__' + owner });
const validate = (fn: () => void) => { try { fn(); } catch { throw new ApiError(400, 'PAYLOAD_INVALID'); } };
/** Full business commands. Only structural/name changes materialize distributions;
 * description-only edits use the persisted temporal index. No GET calls this class. */
export class BusinessCommands {
    readonly coordinator: QueryCoordinator;
    readonly views: PlanViews;
    private readonly clock: () => Date;
    constructor(coordinator: QueryCoordinator, views: PlanViews, clock = () => new Date()) {
        this.coordinator = coordinator; this.views = views; this.clock = clock;
    }
    private async agenda(read: EntityReader, edits: AgendaEdits, owner: string, id: string, plan: TrainingPlan | null, months: string[], pending?: MonthlyAgenda['pending'][number]) {
        for (const month of [...new Set(months)]) {
            let entry = edits.get(month);
            if (!entry) {
                const old = await read<MonthlyAgenda>({ kind: 'agenda', id: month });
                entry = { data: old?.data ?? buildMonthlyAgenda([], month), expected: old?.version ?? null }; edits.set(month, entry);
            }
            entry.data = replaceAgendaPlan(entry.data, owner, id, plan, pending);
        }
    }
    private async finish(read: EntityReader, changes: AggregateChange[], edits: AgendaEdits) {
        for (const [month, entry] of edits) changes.push({ ref: { kind: 'agenda', id: month }, ...entry });
        if (edits.size) {
            const ref = { kind: 'agenda' as const, id: 'calendar' }, prior = await read<{ months: string[] }>(ref);
            const months = [...new Set([...(prior?.data.months ?? []), ...edits.keys()])].sort();
            if (JSON.stringify(months) !== JSON.stringify(prior?.data.months)) changes.push({ ref, data: { months }, expected: prior?.version ?? null });
        }
    }
    repertoire(session: QuerySession, input: Record<string, unknown>) {
        onlyFields(input, ['data', 'expected', 'operationId']);
        validate(() => validateTechniques(input.data));
        const incoming = structuredClone(input.data) as Techniques, operationId = String(input.operationId);
        return this.coordinator.command(session, async (actor, read) => {
            const mail = actor.mail, ref = { kind: 'repertoire' as const, id: mail }, old = await read<AdditionTechniques>(ref);
            if (!old || input.expected !== old.version) throw new ApiError(409, 'VERSION_CONFLICT');
            const next: AdditionTechniques = { ...old.data, positions: incoming.positions };
            const removed = deletedUUIDs(old.data, next), added = hasTrainableAdditions(old.data, next), today = madridDate(this.clock()), stamp = this.clock().toISOString();
            const oldNames = new Map(old.data.positions.flatMap(p => [[p.id, p.posicion], ...p.tecnicas.map(t => [t.id, t.tipo])] as [string, string][]));
            const labels = next.positions.some(p => oldNames.has(p.id) && oldNames.get(p.id) !== p.posicion || p.tecnicas.some(t => oldNames.has(t.id) && oldNames.get(t.id) !== t.tipo));
            if (removed.length || added) {
                if (removed.length) {
                    next.deletionRevision = (old.data.deletionRevision ?? 0) + 1;
                    next.deletedIds = [...new Set([...(old.data.deletedIds ?? []), ...removed])];
                }
                if (added) next.additionRevision = (old.data.additionRevision ?? 0) + 1;
                next.deletionCatalog = old.data.deletionCatalog ?? catalogOf(old.data);
            }
            const idsChanged = descriptionChanges(old.data, next), retained = new Set(next.positions.flatMap(p => p.tecnicas.map(t => t.id)));
            const versions = updateTextVersions(old.data.descriptionUpdates, idsChanged, opaqueToken());
            for (const id of Object.keys(versions)) if (!retained.has(id)) delete versions[id];
            if (Object.keys(versions).length) next.descriptionUpdates = versions; else delete next.descriptionUpdates;
            if (blockDigest(next) !== blockDigest(old.data)) { next.revision++; next.updatedAt = stamp; }
            const sourceBytes = jsonBytes(next);
            if (sourceBytes > MAX_JSON_BYTES) throw new ApiError(413, 'JSON_TOO_LARGE', undefined,
                {file: 'tecnics.json', bytes: sourceBytes, limitBytes: MAX_JSON_BYTES, scope: 'document', exact: true});
            const notes = await read<Comments>({ kind: 'comments', id: mail }), assignments = await read<AssignmentState>({ kind: 'assignment', id: mail }),
                catalog = await read<Catalog>({ kind: 'catalog', id: 'competitions' });
            if (!notes || !assignments || !catalog) throw new ApiError(409, 'REGISTRATION_INCOMPLETE');
            const comments = { ...notes.data, comments: notes.data.comments.filter(c => retained.has(c.techniqueId)) };
            if (comments.commentUpdates) comments.commentUpdates = Object.fromEntries(Object.entries(comments.commentUpdates).filter(([id]) => retained.has(id)));
            const changes: AggregateChange[] = [{ ref, data: next, expected: old.version }], plans: PlanChange[] = [], edits: AgendaEdits = new Map();
            if (blockDigest(comments) !== blockDigest(notes.data)) {
                comments.revision++; comments.updatedAt = stamp;
                changes.push({ ref: { kind: 'comments', id: mail }, data: comments, expected: notes.version });
            }
            const assignment = structuredClone(assignments.data), issues = { ...assignment.projectionIssues };
            for (const c of catalog.data.plans.filter(c => c.alumnos.includes(mail) && (c.fecha_torneo > today || assignments.data.pendingPlanIds?.includes(c.planId)) && assignments.data.planIds.includes(c.planId))) {
                const text = await read<PlanTextProjection>(refText(mail, c.planId));
                if (!text) {
                    if (!trainable(next)) { assignment.pendingPlanIds = [...new Set([...(assignment.pendingPlanIds ?? []), c.planId])]; continue; }
                    const plan = generatePlan(c, mail, next, comments, stamp) as AdditionPlan;
                    plan.appliedDescriptionUpdates = { ...next.descriptionUpdates }; plan.appliedCommentUpdates = { ...comments.commentUpdates };
                    if (next.additionRevision) plan.appliedAdditionRevision = next.additionRevision;
                    const bytes = jsonBytes(plan);
                    if (bytes > MAX_JSON_BYTES) { issues[c.planId] = { code: 'PLAN_TOO_LARGE', bytes }; continue; }
                    const head = await this.views.plans.head(mail, c.planId);
                    if (head) throw new ApiError(409, 'PLAN_TEXT_NOT_PUBLISHED');
                    plans.push({ owner: mail, planId: c.planId, data: plan, expected: null });
                    changes.push({ ref: refText(mail, c.planId), data: indexPlanText(plan), expected: null });
                    assignment.pendingPlanIds = assignment.pendingPlanIds?.filter(id => id !== c.planId);
                    delete issues[c.planId];
                    await this.agenda(read, edits, mail, c.planId, plan, plan.sessions.map(s => s.date.slice(0, 7)));
                    continue;
                }
                try {
                    if (removed.length || added || labels || text.data.metadata.structuralUpdateError) {
                        const current = await this.views.read(mail, c.planId);
                        if (!current) continue;
                        let updated = updateFuturePlanLabels(updateFuturePlanText(updateFutureStructure(current.data, next, comments, today), next, comments, today), next, today);
                        if (updated === current.data) continue;
                        updated = { ...updated, revision: current.data.revision + 1, updatedAt: stamp };
                        const bytes = jsonBytes(updated);
                        if (bytes > MAX_JSON_BYTES) throw new ProjectedPlanTooLarge(c.planId, bytes);
                        plans.push({ owner: mail, planId: c.planId, data: updated, expected: current.version.distribution });
                        changes.push({ ref: refText(mail, c.planId), data: indexPlanText(updated), expected: text.version });
                        await this.agenda(read, edits, mail, c.planId, updated, updated.sessions.map(s => s.date.slice(0, 7)).filter(m => m >= today.slice(0, 7)));
                    } else {
                        let updated = projectPlanText(text.data, next, comments, today);
                        if (updated !== text.data) {
                            updated = updateProjectionMetadata(updated, { revision: text.data.metadata.revision + 1, updatedAt: stamp });
                            changes.push({ ref: refText(mail, c.planId), data: updated, expected: text.version });
                        }
                    }
                    delete issues[c.planId];
                } catch (error) {
                    if (!(error instanceof ProjectedPlanTooLarge)) throw error;
                    issues[c.planId] = { code: 'PLAN_TOO_LARGE', bytes: error.bytes };
                }
            }
            if (Object.keys(issues).length) assignment.projectionIssues = issues; else delete assignment.projectionIssues;
            if (blockDigest(assignment) !== blockDigest(assignments.data)) changes.push({ ref: { kind: 'assignment', id: mail }, data: assignment, expected: assignments.version });
            await this.finish(read, changes, edits);
            return { changes, plans, operationId };
        }, { operationId, requestHash: blockDigest([session.mail, 'repertoire', input]) });
    }
    comments(session: QuerySession, input: Record<string, unknown>) {
        onlyFields(input, ['data', 'owner', 'expected', 'operationId']);
        const operationId = String(input.operationId), data = input.data as Comments;
          if (!data || !Array.isArray(data.comments) || data.comments.length > 20000 ||
              data.comments.some(c => !c || typeof c !== 'object' || typeof c.techniqueId !== 'string' || typeof c.comment !== 'string') ||
            new Set(data.comments.map(c => c.techniqueId)).size !== data.comments.length) throw new ApiError(400, 'COMMENTS_INVALID');
        return this.coordinator.command(session, async (actor, read) => {
            if (actor.perfil !== 'entrenador') throw new ApiError(403, 'TRAINER_REQUIRED');
            const owner = normalizedMail(input.owner || session.mail);
            const ref = { kind: 'comments' as const, id: owner }, old = await read<Comments>(ref), techniques = await read<Techniques>({ kind: 'repertoire', id: owner });
            if (!old || !techniques || old.version !== input.expected) throw new ApiError(409, 'VERSION_CONFLICT');
            const ids = new Set(techniques.data.positions.flatMap(p => p.tecnicas.map(t => t.id))), previous = new Map(old.data.comments.map(c => [c.techniqueId, c]));
            for (const c of data.comments) if (!ids.has(c.techniqueId) || typeof c.comment !== 'string' || c.comment.length > MAX_TEXT_LENGTH) throw new ApiError(400, 'COMMENT_INVALID');
            const comments: Comments = { ...old.data, comments: data.comments.map(c => {
                const prior = previous.get(c.techniqueId), trainerName = c.comment !== prior?.comment && c.comment.trim() ? [actor.nombre, actor.apellidos].filter(Boolean).join(' ').trim() : prior?.trainerName;
                return { techniqueId: c.techniqueId, comment: c.comment, ...(trainerName ? { trainerName } : {}) };
            }) };
            const versions = updateTextVersions(old.data.commentUpdates, commentChanges(old.data, comments), opaqueToken());
            if (Object.keys(versions).length) comments.commentUpdates = versions;
            const stamp = this.clock().toISOString(), today = madridDate(this.clock());
            if (blockDigest(comments) !== blockDigest(old.data)) { comments.revision++; comments.updatedAt = stamp; }
            const sourceBytes = jsonBytes(comments);
            if (sourceBytes > MAX_JSON_BYTES) throw new ApiError(413, 'JSON_TOO_LARGE', undefined,
                {file: 'trainer_comments.json', bytes: sourceBytes, limitBytes: MAX_JSON_BYTES, scope: 'document', exact: true});
            const changes: AggregateChange[] = [{ ref, data: comments, expected: old.version }];
            const assignments = await read<AssignmentState>({ kind: 'assignment', id: owner }), catalog = await read<Catalog>({ kind: 'catalog', id: 'competitions' });
            if (!assignments || !catalog) throw new ApiError(409, 'REGISTRATION_INCOMPLETE');
            const next = structuredClone(assignments.data), issues = { ...next.projectionIssues };
            for (const c of catalog.data.plans.filter(c => c.alumnos.includes(owner) && c.fecha_torneo > today && next.planIds.includes(c.planId))) {
                const text = await read<PlanTextProjection>(refText(owner, c.planId)); if (!text) continue;
                try {
                    let projected = projectPlanText(text.data, techniques.data, comments, today);
                    if (projected !== text.data) {
                        projected = updateProjectionMetadata(projected, { revision: text.data.metadata.revision + 1, updatedAt: stamp });
                        changes.push({ ref: refText(owner, c.planId), data: projected, expected: text.version });
                    }
                    delete issues[c.planId];
                } catch (error) { if (!(error instanceof ProjectedPlanTooLarge)) throw error; issues[c.planId] = { code: 'PLAN_TOO_LARGE', bytes: error.bytes }; }
            }
            if (Object.keys(issues).length) next.projectionIssues = issues; else delete next.projectionIssues;
            if (blockDigest(next) !== blockDigest(assignments.data)) changes.push({ ref: { kind: 'assignment', id: owner }, data: next, expected: assignments.version });
            return { changes, operationId };
        }, { operationId, requestHash: blockDigest([session.mail, 'comments', input]) });
    }
    competition(session: QuerySession, kind: 'competition' | 'assignment' | 'delete-competition' | 'prepare', input: Record<string, unknown>) {
        onlyFields(input, kind === 'competition' ? ['competition', 'expected', 'operationId'] : kind === 'assignment' ? ['planId', 'alumnos', 'expected', 'operationId'] : ['planId', 'expected', 'operationId']);
        const operationId = String(input.operationId);
        return this.coordinator.command(session, async (actor, read) => {
            if (actor.perfil !== 'entrenador') throw new ApiError(403, 'TRAINER_REQUIRED');
            const catalogRef = { kind: 'catalog' as const, id: 'competitions' }, old = await read<Catalog>(catalogRef);
            if (input.expected !== (old?.version ?? null)) throw new ApiError(409, 'VERSION_CONFLICT');
            const catalog: Catalog = structuredClone(old?.data ?? { ...initialVersion(), plans: [], deletedPlanIds: [] });
            const previous = old?.data.plans.find(p => p.planId === input.planId), today = madridDate(this.clock()), stamp = this.clock().toISOString();
            let competition: Competition;
            if (kind === 'competition') {
                const data = input.competition as Competition;
                validate(() => validateCompetition(data, 1));
                if (!Array.isArray(data.alumnos) || data.alumnos.length > 100) throw new ApiError(400, 'STUDENTS_INVALID');
                competition = { planId: crypto.randomUUID(), fecha_comienzo: data.fecha_comienzo, fecha_torneo: data.fecha_torneo,
                    dias_de_entrenamiento: [...data.dias_de_entrenamiento], ejercicios_por_sesion: data.ejercicios_por_sesion,
                    tiempo_por_tecnica_segundos: data.tiempo_por_tecnica_segundos, descanso_entre_ciclos_segundos: data.descanso_entre_ciclos_segundos,
                    descanso_entre_tecnicas_segundos: data.descanso_entre_tecnicas_segundos, alumnos: [...new Set(data.alumnos.map(normalizedMail))] };
                catalog.plans.push(competition);
            } else {
                if (!previous) throw new ApiError(404, 'COMPETITION_NOT_FOUND');
                competition = catalog.plans.find(p => p.planId === previous.planId)!;
                if (kind === 'assignment') {
                    if (!Array.isArray(input.alumnos) || input.alumnos.length > 100) throw new ApiError(400, 'STUDENTS_INVALID');
                    competition.alumnos = [...new Set(input.alumnos.map(normalizedMail))];
                } else if (kind === 'delete-competition') {
                    catalog.plans = catalog.plans.filter(p => p.planId !== previous.planId);
                    catalog.deletedPlanIds = [...new Set([...catalog.deletedPlanIds, previous.planId])];
                    competition.alumnos = [];
                }
            }
            const affected = [...new Set([...(previous?.alumnos ?? []), ...competition.alumnos])];
            const changes: AggregateChange[] = [], plans: PlanChange[] = [], edits: AgendaEdits = new Map();
            for (const owner of affected) {
                const profile = await read<Profile>({ kind: 'profile', id: owner });
                if (!profile) throw new ApiError(404, 'USER_NOT_FOUND');
                const assignmentRef = { kind: 'assignment' as const, id: owner }, stored = await read<AssignmentState>(assignmentRef);
                if (!stored) throw new ApiError(409, 'REGISTRATION_INCOMPLETE');
                const assignment = structuredClone(stored.data), id = competition.planId, assigned = competition.alumnos.includes(owner);
                const head = await this.views.plans.head(owner, id);
                const text = await read<PlanTextProjection>(refText(owner, id));
                if (!assigned) {
                    assignment.planIds = assignment.planIds.filter(p => p !== id);
                    assignment.deletedPlanIds = [...new Set([...(assignment.deletedPlanIds ?? []), id])];
                    if (head) {
                        plans.push({ owner, planId: id, data: null, expected: head.version });
                        await this.agenda(read, edits, owner, id, null, head.data.head.calendar.map(s => s.date.slice(0, 7)));
                    }
                    else await this.agenda(read, edits, owner, id, null, monthsOf(competition));
                    // A tombstoned binding cannot serve the retained base or be mixed with reassignment.
                    if (text) changes.push({ ref: refText(owner, id), data: { deleted: true }, expected: text.version });
                } else {
                    assignment.planIds = [...new Set([...assignment.planIds, id])];
                    assignment.deletedPlanIds = (assignment.deletedPlanIds ?? []).filter(p => p !== id);
                    if (!head) {
                        const t = await read<AdditionTechniques>({ kind: 'repertoire', id: owner }), comments = await read<Comments>({ kind: 'comments', id: owner });
                        if (!t || !comments) throw new ApiError(409, 'REGISTRATION_INCOMPLETE');
                        const pending = new Set(assignment.pendingPlanIds ?? []);
                        if (!trainable(t.data)) pending.add(id);
                        else {
                            const plan = generatePlan(competition, owner, t.data, comments.data, stamp) as AdditionPlan;
                            plan.appliedDescriptionUpdates = { ...t.data.descriptionUpdates }; plan.appliedCommentUpdates = { ...comments.data.commentUpdates };
                            if (t.data.additionRevision) plan.appliedAdditionRevision = t.data.additionRevision;
                            if (jsonBytes(plan) > MAX_JSON_BYTES) {
                                pending.add(id); assignment.projectionIssues = { ...assignment.projectionIssues, [id]: { code: 'PLAN_TOO_LARGE', bytes: jsonBytes(plan) } };
                            } else {
                                // Stage one generated distribution at a time; keep only
                                // its compact unpublished head through the final CAS.
                                plans.push({ owner, planId: id, data: null, expected: null,
                                    prepared: await this.views.plans.prepare(plan, null, operationId, competition.alumnos.length > 6) });
                                changes.push({ ref: refText(owner, id), data: indexPlanText(plan), expected: text?.version ?? null });
                                await this.agenda(read, edits, owner, id, plan, plan.sessions.map(s => s.date.slice(0, 7)));
                                pending.delete(id); if (assignment.projectionIssues) delete assignment.projectionIssues[id];
                            }
                        }
                        assignment.pendingPlanIds = [...pending];
                        if (pending.has(id)) await this.agenda(read, edits, owner, id, null, monthsOf(competition),
                            { owner, planId: id, start: competition.fecha_comienzo, end: competition.fecha_torneo });
                    }
                }
                if (!assigned) {
                    if (assignment.pendingPlanIds) assignment.pendingPlanIds = assignment.pendingPlanIds.filter(p => p !== id);
                    if (assignment.projectionIssues) delete assignment.projectionIssues[id];
                }
                if (blockDigest(assignment) !== blockDigest(stored.data)) {
                    assignment.revision++; assignment.updatedAt = stamp;
                    changes.push({ ref: assignmentRef, data: assignment, expected: stored.version });
                }
            }
            if (kind !== 'prepare' && blockDigest(catalog) !== blockDigest(old?.data)) { catalog.revision++; catalog.updatedAt = stamp; }
            changes.unshift({ ref: catalogRef, data: catalog, expected: old?.version ?? null });
            await this.finish(read, changes, edits);
            return { changes, plans, operationId, metadata: { planId: competition.planId } };
        }, { operationId, requestHash: blockDigest([session.mail, kind, input]) });
    }
}
