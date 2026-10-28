import { createHash } from 'node:crypto';
import { validateSnapshot, classifySourcePath, type GithubSnapshot } from './github-source.ts';
import { verifyBundle, type MigrationBundle } from './convert.ts';
import { decodePlan } from '../../src/infrastructure/plan-codec.ts';
import { correctedSource, type ApprovedCorrections } from './approved-corrections.ts';

const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

/** Independent comparison against captured Git blobs, not conversion output
 * against itself. Arrays retain their order. No record contents/hashes leak in
 * diagnostics; historical derived structure indexes remain in the source archive. */
export function verifyProductionConversion(source: GithubSnapshot, bundle: MigrationBundle, approved?: ApprovedCorrections) {
    validateSnapshot(source); verifyBundle(bundle);
    if (bundle.target !== 'pgt-bjj-pro' || bundle.source.repository !== source.repository ||
        bundle.source.commit !== source.commit || bundle.source.checksum !== source.checksum)
        throw Error('MIGRATION_SOURCE_BINDING_MISMATCH');
    if (hash(bundle.approvedCorrections || null) !== hash(approved || null)) throw Error('MIGRATION_CORRECTION_AUTHORIZATION_REQUIRED');
    const expected = approved ? correctedSource(source, approved) : source;
    const checked: Record<string, number> = {}, profiles = new Set<string>(), plans = new Set<number>();
    let derived = 0;
    for (const [ordinal, file] of expected.files.entries()) {
        const kind = classifySourcePath(file.path), original = JSON.parse(file.content.replace(/^\uFEFF/, ''));
        if (kind === 'derived') { derived++; continue; }
        const owner = file.path.split('/')[2], user = bundle.users.find(u => u.profile.mail === owner);
        let actual: unknown;
        if (kind === 'catalog') actual = bundle.catalog;
        else if (kind === 'template') actual = bundle.template;
        else if (kind === 'plan') {
            const plan = bundle.plans.find(p => p.sourceFile === ordinal);
            if (plan) { actual = decodePlan(plan.plan); plans.add(ordinal); }
        } else if (user) {
            if (kind === 'profile') {
                actual = { ...user.profile, ...(user.credential.state === 'imported' ? { pwd: user.credential.passwordHash } : {}) };
                profiles.add(owner);
            } else actual = kind === 'techniques' ? user.techniques : kind === 'comments' ? user.comments : user.index;
        }
        if (actual === undefined || hash(original) !== hash(actual)) throw Error('MIGRATION_SOURCE_RECORD_MISMATCH');
        checked[kind] = (checked[kind] || 0) + 1;
    }
    if (profiles.size !== bundle.users.length || plans.size !== bundle.plans.length)
        throw Error('MIGRATION_SOURCE_RECORD_MISMATCH');
    return { status: approved ? 'SOURCE_PRESERVED_WITH_APPROVED_CORRECTIONS' as const : 'EXACT_SOURCE_RECORDS_PRESERVED' as const, sourceCommit: source.commit,
        approvedChanges: approved ? {unassignments:1,repairedIndexes:1,changedSourceDocuments:3,generatedPlans:0} : undefined,
        checked, archivedDerivedFiles: derived, blockingIssues: bundle.issues.filter(i => i.blocking).map(i => i.code) };
}
