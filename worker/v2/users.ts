import { initialVersion, cloneTemplate, validateProfile, type Profile, type Template } from '../../src/domain/models.ts';
import { ApiError, normalizedMail, onlyFields, passwordHash, passwordMatches, fingerprint, opaqueToken } from '../security.ts';
import { QueryCoordinator, type QuerySession } from './query-coordinator.ts';
import type { AggregateChange } from './aggregates.ts';
import type { SessionLookup } from './read-api.ts';
import { blockDigest } from '../../src/infrastructure/native-packing.ts';

export interface SessionStorage extends SessionLookup { put<T>(key: string, value: T): Promise<void> }
export type Roster = { users: { mail: string; nombre: string; apellidos: string; perfil: Profile['perfil']; cinturon?: Profile['cinturon'] }[] };
const publicProfile = (p: Profile) => { const { pwd, probeOnly, ...safe } = p; return safe; };
const rosterProfile = (p: Profile) => ({ mail: p.mail, nombre: p.nombre, apellidos: p.apellidos, perfil: p.perfil, cinturon: p.cinturon });
function validate(p: Profile) { try { validateProfile(p); } catch { throw new ApiError(400, 'PROFILE_INVALID'); } }
export class UserService {
    private readonly coordinator: QueryCoordinator;
    private readonly sessions: SessionStorage;
    constructor(coordinator: QueryCoordinator, sessions: SessionStorage) { this.coordinator = coordinator; this.sessions = sessions; }
    private async mint(p: Profile) {
        const token = opaqueToken();
        await this.sessions.put('pgt-v2-session:' + await fingerprint(token), {
            mail: p.mail, role: p.perfil, pwdFingerprint: await fingerprint(p.pwd!)
        } satisfies QuerySession);
        return { token, profile: publicProfile(p) };
    }
    login(input: Record<string, unknown>) {
        onlyFields(input, ['mail', 'password']);
        const mail = normalizedMail(input.mail);
        return this.coordinator.internal(async read => {
            const p = await read<Profile>({ kind: 'profile', id: mail });
            const matches = await passwordMatches(input.password, p?.data.pwd || 'pbkdf2-sha256$600000$unknown$unknown');
            if (!matches || !p || p.data.probeOnly) throw new ApiError(401, 'LOGIN_FAILED');
            return this.mint(p.data);
        });
    }
    register(input: Record<string, unknown>) {
        onlyFields(input, ['mail', 'password', 'confirm', 'nombre', 'apellidos']);
        const mail = normalizedMail(input.mail);
        if (input.password !== input.confirm) throw new ApiError(400, 'PASSWORDS_DIFFER');
        return this.coordinator.internal(async (read, publish) => {
            const ref = { kind: 'profile' as const, id: mail }, prior = await read<Profile>(ref);
            if (prior) {
                if (prior.data.probeOnly || !await passwordMatches(input.password, prior.data.pwd || '')) throw new ApiError(409, 'USER_EXISTS');
                return this.mint(prior.data);
            }
            const p: Profile = { ...initialVersion(), mail, nombre: typeof input.nombre === 'string' ? input.nombre : '',
                apellidos: typeof input.apellidos === 'string' ? input.apellidos : '', peso: null, fecha_nacimiento: null,
                cinturon: 'Blanco', perfil: 'alumno' };
            validate(p);
            const template = await read<Template>({ kind: 'template', id: 'official' });
            if (!template) throw new ApiError(503, 'OFFICIAL_TEMPLATE_REQUIRED');
            p.pwd = await passwordHash(input.password);
            const roster = await read<Roster>({ kind: 'roster', id: 'users' });
            const changes: AggregateChange[] = [
                { ref, data: p, expected: null },
                { ref: { kind: 'repertoire', id: mail }, data: cloneTemplate(template.data), expected: null },
                { ref: { kind: 'comments', id: mail }, data: { ...initialVersion(), comments: [] }, expected: null },
                { ref: { kind: 'assignment', id: mail }, data: { ...initialVersion(), planIds: [] }, expected: null },
                { ref: { kind: 'roster', id: 'users' }, data: { users: [...(roster?.data.users ?? []), rosterProfile(p)] }, expected: roster?.version ?? null }
            ];
            await publish({ changes, operationId: crypto.randomUUID() });
            return this.mint(p);
        });
    }
    async change(session: QuerySession, kind: 'profile' | 'password' | 'role' | 'belt', input: Record<string, unknown>) {
        onlyFields(input, kind === 'profile' ? ['mail', 'data', 'expected', 'operationId'] :
            kind === 'password' ? ['mail', 'password', 'confirm', 'expected', 'operationId'] :
                kind === 'belt' ? ['mail', 'cinturon', 'expected', 'operationId'] : ['mail', 'perfil', 'expected', 'operationId']);
        const mail = normalizedMail(input.mail || session.mail);
        const operationId = typeof input.operationId === 'string' ? input.operationId : crypto.randomUUID();
        await this.coordinator.command(session, async (actor, read) => {
            if (kind === 'profile' && mail !== actor.mail) throw new ApiError(403, 'OWN_PROFILE_ONLY');
            if ((kind === 'role' || kind === 'belt' || mail !== actor.mail) && actor.perfil !== 'entrenador') throw new ApiError(403, 'TRAINER_REQUIRED');
            const ref = { kind: 'profile' as const, id: mail }, current = await read<Profile>(ref);
            if (!current) throw new ApiError(404, 'USER_NOT_FOUND');
            if (input.expected !== current.version) throw new ApiError(409, 'VERSION_CONFLICT');
            let next = structuredClone(current.data);
            if (kind === 'profile') {
                if (!input.data || typeof input.data !== 'object' || Array.isArray(input.data)) throw new ApiError(400, 'PROFILE_INVALID');
                const p = input.data as Profile;
                next = { ...next, nombre: p.nombre, apellidos: p.apellidos, peso: p.peso, cinturon: p.cinturon, fecha_nacimiento: p.fecha_nacimiento };
                validate(next);
            } else if (kind === 'belt') {
                if (current.data.perfil !== 'alumno') throw new ApiError(400, 'STUDENT_REQUIRED');
                next.cinturon = input.cinturon as Profile['cinturon'];
                validate(next);
            } else if (kind === 'password') {
                if (mail !== actor.mail && current.data.perfil !== 'alumno') throw new ApiError(400, 'STUDENT_REQUIRED');
                if (input.password !== input.confirm) throw new ApiError(400, 'PASSWORDS_DIFFER');
                next.pwd = await passwordHash(input.password);
            } else {
                if (input.perfil !== 'alumno' && input.perfil !== 'entrenador') throw new ApiError(400, 'ROLE_INVALID');
                if (mail === actor.mail && input.perfil === 'alumno') throw new ApiError(400, 'SELF_DEMOTION_FORBIDDEN');
                next.perfil = input.perfil;
            }
            const changed = JSON.stringify(next) !== JSON.stringify(current.data);
            if (kind !== 'password' && changed) { next.revision++; next.updatedAt = new Date().toISOString(); }
            const changes: AggregateChange[] = [{ ref, data: next, expected: current.version }];
            if (kind !== 'password' && changed) {
                const rosterRef = { kind: 'roster' as const, id: 'users' }, roster = await read<Roster>(rosterRef);
                const users = roster?.data.users ?? [];
                changes.push({ ref: rosterRef, expected: roster?.version ?? null,
                    data: { users: [...users.filter(p => p.mail !== mail), rosterProfile(next)] } });
            }
            return { changes, operationId };
        }, { operationId, requestHash: blockDigest([normalizedMail(session.mail), kind, input]) });
        // Credential/role changes invalidate the cached profile before another request;
        // every existing session's fingerprint/role then fails without scanning sessions.
        return kind === 'profile' || kind === 'belt' ? this.coordinator.user(session, { kind: 'profile', owner: mail }) : { status: kind === 'password' ? 'PASSWORD_CHANGED_SESSION_REVOKED' : 'ROLE_CHANGED' };
    }
}
