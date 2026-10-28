import { createHash } from 'node:crypto';
import { validateSnapshot, classifySourcePath, type GithubSnapshot } from './github-source.ts';
import { encodePlan, type EncodedPlan } from '../../src/infrastructure/plan-codec.ts';
import { indexPlanText, type PlanTextProjection } from '../../src/infrastructure/plan-text-projection.ts';
import { validateProfile, validateTechniques, validateVersion, validateCompetition, validatePlan, cloneTemplate, type Profile, type Techniques, type Comments, type Index, type Catalog, type Template, type TrainingPlan } from '../../src/domain/models.ts';
import { MAX_TEXT_LENGTH } from '../../src/domain/json-limits.ts';
import { normalizedMail } from '../../worker/security.ts';
import { correctedSource, type ApprovedCorrections } from './approved-corrections.ts';
export type MigrationTarget = 'pgt-bjj-dev' | 'pgt-bjj-pro';
export type MigrationIssue = {
    code: string;
    file: number;
    blocking: boolean;
};
export interface ConvertedUser {
    profile: Omit<Profile, 'pwd'>;
    techniques?: Techniques;
    comments?: Comments;
    index?: Index;
    credential: {
        state: 'requires-dev-password';
    } | {
        state: 'imported';
        passwordHash: string;
    };
}
export interface MigrationBundle {
    format: 'pgt-firestore-import-v2';
    target: MigrationTarget;
    source: {
        repository: string;
        commit: string;
        checksum: string;
    };
    template?: Template;
    catalog?: Catalog;
    users: ConvertedUser[];
    plans: {
        plan: EncodedPlan;
        text: PlanTextProjection;
        sourceFile: number;
    }[];
    issues: MigrationIssue[];
    ready: boolean;
    approvedCorrections?: ApprovedCorrections;
    checksum: string;
}
export const validImportedPasswordHash = (value: unknown): value is string => typeof value === 'string' && /^pbkdf2-sha256\$600000\$[^$]+\$[A-Za-z0-9+/]{43}=$/.test(value) && Buffer.from(value.split('$')[3], 'base64').length === 32;
const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function verifyBundle(bundle: MigrationBundle): void {
    const { checksum, ...body } = bundle;
    if (bundle.format !== 'pgt-firestore-import-v2' || !['pgt-bjj-dev', 'pgt-bjj-pro'].includes(bundle.target) || digest(body) !== checksum)
        throw Error('MIGRATION_BUNDLE_INTEGRITY');
}
/** Converts captured records. Rebuilds derived assignment indexes from the
 * authoritative catalog; never regenerates or repairs saved plan snapshots. */
export function convertSnapshot(snapshot: GithubSnapshot, target: MigrationTarget, corrections?: ApprovedCorrections): MigrationBundle {
    validateSnapshot(snapshot);
    if (corrections) {
        if (target !== 'pgt-bjj-pro') throw Error('MIGRATION_CORRECTION_TARGET_INVALID');
        const converted = convertSnapshot(correctedSource(snapshot, corrections), target);
        const { checksum, ...data } = converted;
        const body = { ...data, source: {repository:snapshot.repository,commit:snapshot.commit,checksum:snapshot.checksum},
            approvedCorrections: structuredClone(corrections) };
        return {...body,checksum:digest(body)};
    }
    if (!['pgt-bjj-dev', 'pgt-bjj-pro'].includes(target))
        throw Error('MIGRATION_TARGET_INVALID');
    const issues: MigrationIssue[] = [], users = new Map<string, ConvertedUser>(), owners = new Map<string, string>(), plans: MigrationBundle['plans'] = [];
    const documents = snapshot.files.map((f, file) => ({ file, path: f.path, kind: classifySourcePath(f.path), data: JSON.parse(f.content.replace(/^\uFEFF/, '')) as any }));
    const issue = (code: string, file: number, blocking = true) => issues.push({ code, file, blocking });
    const own = (path: string) => normalizedMail(path.split('/')[2]);
    for (const d of documents.filter(d => d.kind === 'profile')) {
        try {
            const p = d.data as Profile;
            validateProfile(p);
            if (p.mail !== own(d.path))
                throw Error();
            if (users.has(p.mail))
                throw Error();
            const { pwd, ...profile } = p;
            const credential: ConvertedUser['credential'] = target === 'pgt-bjj-dev' ? { state: 'requires-dev-password' } :
                validImportedPasswordHash(pwd) ? { state: 'imported', passwordHash: pwd } : (() => { throw Error(); })();
            users.set(p.mail, { profile, credential });
        }
        catch {
            issue('PROFILE_OR_CREDENTIAL_INVALID', d.file);
        }
    }
    let template: Template | undefined, catalog: Catalog | undefined;
    for (const d of documents) {
        if (d.kind === 'profile' || d.kind === 'plan' || d.kind === 'derived')
            continue;
        try {
            if (d.kind === 'template') {
                cloneTemplate(d.data);
                template = d.data;
                continue;
            }
            if (d.kind === 'catalog') {
                validateVersion(d.data as unknown);
                if (!Array.isArray(d.data.plans) || !Array.isArray(d.data.deletedPlanIds))
                    throw Error();
                const ids = new Set<string>();
                for (const c of d.data.plans) {
                    validateCompetition(c);
                    if (!/^[0-9a-f-]{36}$/i.test(c.planId) || ids.has(c.planId) || !Array.isArray(c.alumnos))
                        throw Error();
                    ids.add(c.planId);
                    for (const mail of c.alumnos)
                        if (!users.has(mail))
                            issue('PARTICIPANT_PROFILE_MISSING', d.file);
                }
                catalog = d.data;
                continue;
            }
            const owner = own(d.path), user = users.get(owner);
            if (!user) {
                issue('OWNER_PROFILE_MISSING', d.file);
                continue;
            }
            validateVersion(d.data as unknown);
            if (d.kind === 'techniques') {
                validateTechniques(d.data);
                for (const p of d.data.positions)
                    for (const id of [p.id, ...p.tecnicas.map((t: any) => t.id)]) {
                        if (owners.has(id) && owners.get(id) !== owner)
                            issue('UUID_SHARED_BETWEEN_USERS', d.file);
                        owners.set(id, owner);
                    }
                user.techniques = d.data;
            }
            else if (d.kind === 'comments') {
                if (!Array.isArray(d.data.comments) || new Set(d.data.comments.map((c: any) => c.techniqueId)).size !== d.data.comments.length)
                    throw Error();
                for (const c of d.data.comments)
                    if (typeof c.techniqueId !== 'string' || typeof c.comment !== 'string' || c.comment.length > MAX_TEXT_LENGTH ||
                        c.trainerName !== undefined && typeof c.trainerName !== 'string')
                        throw Error();
                user.comments = d.data;
            }
            else if (d.kind === 'index') {
                if (!Array.isArray(d.data.planIds) || d.data.planIds.some((id: any) => typeof id !== 'string') ||
                    d.data.deletedPlanIds !== undefined && !Array.isArray(d.data.deletedPlanIds))
                    throw Error();
                user.index = d.data;
            }
        }
        catch {
            issue('SOURCE_DOCUMENT_INVALID', d.file);
        }
    }
    if (!template)
        issue('OFFICIAL_TEMPLATE_MISSING', -1);
    if (!catalog)
        issue('COMPETITION_CATALOG_MISSING', -1);
    for (const d of documents.filter(d => d.kind === 'plan')) {
        try {
            const p = d.data as TrainingPlan;
            validatePlan(p);
            const owner = own(d.path);
            if (p.mail !== owner || !users.has(owner) || d.path.split('/').at(-1) !== 'plan_' + p.planId + '.json')
                throw Error();
            const assigned = catalog?.plans.some(c => c.planId === p.planId && c.alumnos.includes(owner)) && !catalog?.deletedPlanIds.includes(p.planId);
            // Never silently resurrect or drop a stored, unassigned plan.
            if (!assigned)
                issue('STORED_PLAN_NOT_ASSIGNED', d.file);
            plans.push({ plan: encodePlan(p), text: indexPlanText(p), sourceFile: d.file });
        }
        catch {
            issue('PLAN_INVALID_OR_TOO_LARGE', d.file);
        }
    }
    for (const [owner, user] of users) {
        if (!user.techniques || !user.comments || !user.index) {
            issue('USER_INITIALIZATION_INCOMPLETE', -1);
            continue;
        }
        const expected = catalog?.plans.filter(c => c.alumnos.includes(owner)).map(c => c.planId).sort() ?? [];
        if (JSON.stringify([...user.index.planIds].sort()) !== JSON.stringify(expected)) {
            if (target === 'pgt-bjj-pro') {
                issue('ASSIGNMENT_INDEX_INCONSISTENT', -1);
            } else {
            // The original updateIndexes() already treats catalog membership as
            // authoritative. A stale per-user index must not hide assigned plans.
            // Preserve deletion knowledge, excluding assignments restored by the catalog.
            const removed = [...new Set([...(user.index.deletedPlanIds ?? []),
                ...user.index.planIds.filter(id => !expected.includes(id)), ...(catalog?.deletedPlanIds ?? [])])]
                .filter(id => !expected.includes(id));
            user.index = { ...user.index, planIds: expected, deletedPlanIds: removed };
            issue('ASSIGNMENT_INDEX_REBUILT', -1, false);
            }
        }
        for (const planId of expected)
            if (!plans.some(p => p.text.metadata.mail === owner && p.text.metadata.planId === planId))
                issue('ASSIGNED_PLAN_MISSING', -1, target === 'pgt-bjj-pro');
        const valid = new Set(user.techniques.positions.flatMap(p => p.tecnicas.map(t => t.id)));
        if (user.comments.comments.some(c => !valid.has(c.techniqueId)))
            issue('RETIRED_TECHNIQUE_COMMENT', -1, false);
    }
    const result: Omit<MigrationBundle, 'checksum'> = { format: 'pgt-firestore-import-v2', target,
        source: { repository: snapshot.repository, commit: snapshot.commit, checksum: snapshot.checksum },
        ...(template ? { template } : {}), ...(catalog ? { catalog } : {}), users: [...users.values()], plans, issues, ready: !issues.some(i => i.blocking) };
    return { ...result, checksum: digest(result) };
}
