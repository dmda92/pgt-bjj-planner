import type { Techniques, Comments, Catalog, Index } from '../../src/domain/models.ts';
import { MAX_TEXT_LENGTH, MAX_JSON_BYTES, jsonBytes } from '../../src/domain/json-limits.ts';
import { madridDate, updateTextVersions } from '../../src/domain/plan-text-updates.ts';
import { blockDigest } from '../../src/infrastructure/native-packing.ts';
import { projectPlanText, updateProjectionMetadata, ProjectedPlanTooLarge, type PlanTextProjection } from '../../src/infrastructure/plan-text-projection.ts';
import { ApiError, normalizedMail, opaqueToken, onlyFields } from '../security.ts';
import type { AggregateChange } from './aggregates.ts';
import { QueryCoordinator, type QuerySession } from './query-coordinator.ts';

export type TextCommand = {
    kind: 'description' | 'comment'; operationId: string; owner: string;
    techniqueId: string; text: string | null; expected: string;
};
export interface AssignmentState extends Index {
    projectionIssues?: Record<string, { code: 'PLAN_TOO_LARGE'; bytes: number }>;
    pendingPlanIds?: string[];
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Specific text commands, not whole-document PUTs. Structural edits use a separate
 * handler. All derivation and publication run inside the academy command boundary.
 */
export class TextCommands {
    private readonly coordinator: QueryCoordinator;
    private readonly clock: () => Date;
    constructor(coordinator: QueryCoordinator, clock = () => new Date()) { this.coordinator = coordinator; this.clock = clock; }
    execute(session: QuerySession, input: TextCommand) {
        onlyFields(input, ['kind', 'operationId', 'owner', 'techniqueId', 'text', 'expected']);
        const command = structuredClone(input);
        command.owner = normalizedMail(command.owner);
        if (!['description', 'comment'].includes(command.kind) || !uuid.test(command.operationId) || !uuid.test(command.techniqueId) ||
            typeof command.expected !== 'string' || !/^[1-9]\d*$/.test(command.expected) ||
            !(typeof command.text === 'string' || command.kind === 'comment' && command.text === null) ||
            typeof command.text === 'string' && command.text.length > MAX_TEXT_LENGTH)
            throw new ApiError(400, 'TEXT_COMMAND_INVALID');
        if (command.kind === 'description' && normalizedMail(session.mail) !== command.owner) throw new ApiError(403, 'OWN_TECHNIQUES_ONLY');
        if (command.kind === 'comment' && session.role !== 'entrenador') throw new ApiError(403, 'TRAINER_REQUIRED');
        // Includes the authenticated actor and every accepted input field; no client
        // checkpoint, author, revision or hash is trusted as server metadata.
        const identity = { operationId: command.operationId, requestHash: blockDigest([normalizedMail(session.mail), command]) };
        return this.coordinator.command(session, async (actor, read) => {
            if (command.kind === 'description' && actor.mail !== command.owner) throw new ApiError(403, 'OWN_TECHNIQUES_ONLY');
            if (command.kind === 'comment' && actor.perfil !== 'entrenador') throw new ApiError(403, 'TRAINER_REQUIRED');
            const repertoireRef = { kind: 'repertoire' as const, id: command.owner }, commentsRef = { kind: 'comments' as const, id: command.owner };
            const repertoire = await read<Techniques>(repertoireRef), notes = await read<Comments>(commentsRef);
            if (!repertoire || !notes) throw new ApiError(409, 'REGISTRATION_INCOMPLETE');
            const technique = repertoire.data.positions.flatMap(p => p.tecnicas).find(t => t.id === command.techniqueId);
            if (!technique) throw new ApiError(400, 'TECHNIQUE_NOT_FOUND');
            const source = command.kind === 'description' ? repertoire : notes;
            if (source.version !== command.expected) throw new ApiError(409, 'VERSION_CONFLICT');
            const time = this.clock(), today = madridDate(time), updatedAt = time.toISOString(), versionToken = opaqueToken();
            const techniques = structuredClone(repertoire.data), comments = structuredClone(notes.data);
            let changed = false;
            if (command.kind === 'description') {
                changed = technique.descripcion_del_alumno !== command.text;
                if (changed) {
                    techniques.positions.flatMap(p => p.tecnicas).find(t => t.id === command.techniqueId)!.descripcion_del_alumno = command.text!;
                    techniques.descriptionUpdates = updateTextVersions(techniques.descriptionUpdates, [command.techniqueId], versionToken);
                    techniques.revision++; techniques.updatedAt = updatedAt;
                }
            } else {
                const previous = comments.comments.find(c => c.techniqueId === command.techniqueId);
                changed = command.text === null ? !!previous : previous?.comment !== command.text;
                if (changed) {
                    if (command.text === null) comments.comments = comments.comments.filter(c => c.techniqueId !== command.techniqueId);
                    else {
                        const author = command.text !== previous?.comment && command.text.trim()
                            ? [actor.nombre, actor.apellidos].filter(Boolean).join(' ').trim() : previous?.trainerName;
                        const next = { techniqueId: command.techniqueId, comment: command.text, ...(author ? { trainerName: author } : {}) };
                        if (previous) comments.comments[comments.comments.indexOf(previous)] = next;
                        else comments.comments.push(next);
                    }
                    if ((previous?.comment || '') !== (command.text || ''))
                        comments.commentUpdates = updateTextVersions(comments.commentUpdates, [command.techniqueId], versionToken);
                    comments.revision++; comments.updatedAt = updatedAt;
                }
            }
            const sourceData = command.kind === 'description' ? techniques : comments;
            const bytes = jsonBytes(sourceData);
            if (bytes > MAX_JSON_BYTES) throw new ApiError(413, 'JSON_TOO_LARGE', undefined, {
                file: command.kind === 'description' ? 'tecnics.json' : 'trainer_comments.json', bytes, limitBytes: MAX_JSON_BYTES
            });
            const changes: AggregateChange[] = [{ ref: command.kind === 'description' ? repertoireRef : commentsRef, data: sourceData, expected: source.version }];
            const assignmentRef = { kind: 'assignment' as const, id: command.owner }, assignment = await read<AssignmentState>(assignmentRef);
            const catalog = await read<Catalog>({ kind: 'catalog', id: 'competitions' });
            if (!assignment || !catalog) throw new ApiError(409, 'REGISTRATION_INCOMPLETE');
            const active = catalog.data.plans.filter(p => p.fecha_torneo > today && p.alumnos.includes(command.owner) &&
                assignment.data.planIds.includes(p.planId) && !assignment.data.deletedPlanIds?.includes(p.planId) && !catalog.data.deletedPlanIds.includes(p.planId));
            const state = structuredClone(assignment.data), issues = { ...state.projectionIssues }, pending = new Set(state.pendingPlanIds ?? []);
            for (const plan of active) {
                const ref = { kind: 'plan-text' as const, id: plan.planId + '__' + command.owner }, text = await read<PlanTextProjection>(ref);
                if (!text) { pending.add(plan.planId); continue; }
                if (text.data.metadata.mail !== command.owner || text.data.metadata.planId !== plan.planId) throw new ApiError(409, 'PLAN_IDENTITY_INVALID');
                pending.delete(plan.planId);
                try {
                    let next = projectPlanText(text.data, techniques, comments, today);
                    if (next !== text.data) {
                        next = updateProjectionMetadata(next, { revision: text.data.metadata.revision + 1, updatedAt });
                        changes.push({ ref, data: next, expected: text.version });
                    }
                    delete issues[plan.planId];
                } catch (error) {
                    if (!(error instanceof ProjectedPlanTooLarge)) throw error;
                    // Sources remain correctable; preserve last valid text and durable issue.
                    issues[plan.planId] = { code: 'PLAN_TOO_LARGE', bytes: error.bytes };
                }
            }
            if (Object.keys(issues).length) state.projectionIssues = issues; else delete state.projectionIssues;
            if (pending.size) state.pendingPlanIds = [...pending]; else delete state.pendingPlanIds;
            if (blockDigest(state) !== blockDigest(assignment.data)) {
                state.revision++; state.updatedAt = updatedAt;
                changes.push({ ref: assignmentRef, data: state, expected: assignment.version });
            }
            return { operationId: command.operationId, changes, metadata: {
                owner: command.owner, kind: command.kind, techniqueId: command.techniqueId,
                updatedAt: changed ? updatedAt : sourceData.updatedAt,
                textVersion: command.kind === 'description' ? techniques.descriptionUpdates?.[command.techniqueId] || '' : comments.commentUpdates?.[command.techniqueId] || ''
            } };
        }, identity);
    }
}
