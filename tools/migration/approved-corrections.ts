import { snapshotFromFiles, validateSnapshot, type GithubSnapshot } from './github-source.ts';
import { normalizedMail } from '../../worker/security.ts';

/** Explicit operator instruction; never accepted by the application's API.
 * Only these two operations are supported, with source preconditions checked. */
export type ApprovedCorrections = {
    format: 'pgt-approved-assignment-corrections-v1'; sourceCommit: string; sourceChecksum: string;
    competitionId: string; unassignOwner: string; repairIndexOwner: string; ownerAuthorizationReference: string;
};
export function correctedSource(source: GithubSnapshot, rule: ApprovedCorrections): GithubSnapshot {
    validateSnapshot(source);
    if (!rule || rule.format !== 'pgt-approved-assignment-corrections-v1' ||
        rule.sourceCommit !== source.commit || rule.sourceChecksum !== source.checksum ||
        !/^[a-f0-9-]{36}$/.test(rule.competitionId) || normalizedMail(rule.unassignOwner) !== rule.unassignOwner ||
        normalizedMail(rule.repairIndexOwner) !== rule.repairIndexOwner || rule.unassignOwner === rule.repairIndexOwner ||
        typeof rule.ownerAuthorizationReference !== 'string' || rule.ownerAuthorizationReference.length < 8 ||
        Object.keys(rule).sort().join(',') !== ['format','sourceCommit','sourceChecksum','competitionId','unassignOwner','repairIndexOwner','ownerAuthorizationReference'].sort().join(','))
        throw Error('MIGRATION_CORRECTION_AUTHORIZATION_INVALID');
    const catalogPath = 'PGT/master_data/plans.json';
    const indexPath = (owner: string) => 'PGT/users_data/' + owner + '/plans_index.json';
    const planPath = (owner: string) => 'PGT/users_data/' + owner + '/training_plans/plan_' + rule.competitionId + '.json';
    const read = (path: string) => {
        const file = source.files.find(f => f.path === path);
        if (!file) throw Error('MIGRATION_CORRECTION_PRECONDITION');
        return JSON.parse(file.content.replace(/^\uFEFF/, ''));
    };
    const catalog = read(catalogPath), removed = read(indexPath(rule.unassignOwner)), repaired = read(indexPath(rule.repairIndexOwner));
    const competition = catalog.plans.find((c: any) => c.planId === rule.competitionId);
    if (!competition || !competition.alumnos.includes(rule.unassignOwner) || !competition.alumnos.includes(rule.repairIndexOwner) ||
        removed.planIds.length !== 0 || repaired.planIds.length !== 0 ||
        source.files.some(f => f.path === planPath(rule.unassignOwner)) || !source.files.some(f => f.path === planPath(rule.repairIndexOwner)))
        throw Error('MIGRATION_CORRECTION_PRECONDITION');
    competition.alumnos = competition.alumnos.filter((mail: string) => mail !== rule.unassignOwner);
    removed.deletedPlanIds = [...new Set([...(removed.deletedPlanIds || []), rule.competitionId])];
    repaired.planIds = [rule.competitionId];
    if (repaired.deletedPlanIds) repaired.deletedPlanIds = repaired.deletedPlanIds.filter((id: string) => id !== rule.competitionId);
    const changes = new Map([[catalogPath,catalog],[indexPath(rule.unassignOwner),removed],[indexPath(rule.repairIndexOwner),repaired]]);
    const virtual = snapshotFromFiles(source.commit, source.tree, source.files.map(f => ({path:f.path,
        content:changes.has(f.path) ? JSON.stringify(changes.get(f.path)) : f.content})), source.capturedAt);
    if (virtual.files.some((f,i) => f.path !== source.files[i]?.path)) throw Error('MIGRATION_CORRECTION_PRECONDITION');
    return virtual;
}
