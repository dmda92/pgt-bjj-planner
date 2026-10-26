import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AppApi} from '../worker/application.ts';
import {ApiError} from '../worker/security.ts';
import {GithubContentsStorage, type CloudRecord, type CloudStorageProvider} from '../worker/storage.ts';
import {initialVersion, type TrainingPlan} from '../src/domain/models.ts';
import {template} from './template-fixture.ts';

function fixture() {
    const files = new Map<string, CloudRecord<any>>([['PGT/master_data/tecnics_base.json', {
        data: template,
        sha: '1'.repeat(40)
    }]]);
    const sessions = new Map<string, unknown>();
    let seq = 1;
    let fail: { status: number; code: string } | null = null;
    const validator = new GithubContentsStorage('synthetic', 'main', async () => Response.json({content: {sha: '1'.repeat(40)}}));
    const cloud: CloudStorageProvider = {
        verifyPrivate: async () => {
        }, read: async <T>(p: string) => structuredClone(files.get(p) || null) as CloudRecord<T> | null,
        write: async (p, data, sha) => {
            await validator.write(p, data, sha);
            if (p.includes('/training_plans/') && fail) {
                const f = fail;
                fail = null;
                throw new ApiError(f.status, f.code);
            }
            if ((files.get(p)?.sha ?? null) !== sha) throw new ApiError(409, 'VERSION_CONFLICT');
            const next = (++seq).toString(16).padStart(40, '0');
            files.set(p, {data: structuredClone(data), sha: next});
            return next;
        }, remove: async (p, sha) => {
            assert.equal(files.get(p)?.sha, sha);
            files.delete(p);
        },
        list: async (dir) => [...new Set([...files.keys()].filter(p => p.startsWith(dir + '/')).map(p => p.slice(dir.length + 1).split('/')[0]))].map(name => ({
            name,
            type: name.endsWith('.json') ? 'file' : 'dir',
            sha: files.get(dir + '/' + name)?.sha
        }))
    };
    const store = {
        get: async (k: string) => sessions.get(k),
        put: async (k: string, v: unknown) => {
            sessions.set(k, v);
        },
        delete: async (k: string) => sessions.delete(k),
        list: async ({prefix}: { prefix: string }) => new Map([...sessions].filter(([k]) => k.startsWith(prefix)))
    };
    const api = new AppApi(store as unknown as DurableObjectStorage, cloud, () => new Date('2026-10-16T10:00:00Z'));

    async function call(path: string, method = 'GET', body?: unknown, token = '') {
        const req = new Request('https://fixture' + path, {
            method,
            headers: {Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'},
            body: body ? JSON.stringify(body) : undefined
        });
        try {
            const r = await api.handle(req, new URL(req.url));
            return {status: r.status, body: await r.json() as any};
        } catch (e) {
            if (e instanceof ApiError) return {status: e.status, body: {error: e.message, size: e.size}};
            throw e;
        }
    }

    async function register(mail: string, trainer = false) {
        const r = await call('/api/app/register', 'POST', {
            mail,
            password: 'synthetic-recovery-password',
            confirm: 'synthetic-recovery-password',
            nombre: 'PGT_TEST',
            apellidos: 'Recovery'
        });
        assert.equal(r.status, 201);
        if (trainer) files.get(`PGT/users_data/${mail}/user_data.json`)!.data.perfil = 'entrenador';
        return r.body.token as string;
    }

    return {
        files, sessions, cloud, call, register, fail: (status: number, code = 'INJECTED') => {
            fail = {status, code};
        }
    };
}

const mail = 'pgt_test_recovery@example.com', coach = 'pgt_test_coach@example.com';
const root = `PGT/users_data/${mail}`;
const comp = (n = 100) => ({
    fecha_comienzo: '2026-10-08',
    fecha_torneo: '2026-12-17',
    dias_de_entrenamiento: [1, 2, 3, 4, 5, 6, 7],
    alumnos: [mail],
    ejercicios_por_sesion: n,
    tiempo_por_tecnica_segundos: 1,
    descanso_entre_ciclos_segundos: 1,
    descanso_entre_tecnicas_segundos: 1
});

async function setup() {
    const f = fixture(), token = await f.register(mail), trainer = await f.register(coach, true);
    const t = f.files.get(root + '/tecnics.json')!;
    t.data.positions = [{...t.data.positions[0], tecnicas: t.data.positions[0].tecnicas.slice(0, 1)}];
    return {...f, token, trainer, snapshot: () => f.call(`/api/app/users/${mail}/snapshot`, 'GET', undefined, token)};
}

for (const field of ['description', 'comment'] as const) test(`BUG-005 ${field}: real 4 MiB limit, history, multiple plans, correction, SHA conflict and idempotency`, async () => {
    const f = await setup();
    const other = 'pgt_test_other@example.com', otherToken = await f.register(other);
    const untouched = JSON.stringify([...f.files].filter(([p]) => p.includes(other)));
    const one = await f.call('/api/app/competition', 'POST', {competition: comp(), sha: null}, f.trainer);
    assert.equal(one.status, 200);
    const cat = f.files.get('PGT/master_data/plans.json')!;
    assert.equal((await f.call('/api/app/competition', 'POST', {
        competition: comp(1),
        sha: cat.sha
    }, f.trainer)).status, 200);
    const initial = await f.snapshot();
    assert.equal(initial.status, 200);
    assert.equal(initial.body.plans.length, 2);
    const plans = initial.body.plans.map((r: any) => r.data as TrainingPlan);
    const big: TrainingPlan = plans.find((p: TrainingPlan) => p.ejercicios_por_sesion === 100)!;
    const bigPath = `${root}/training_plans/plan_${big.planId}.json`, before = structuredClone(f.files.get(bigPath));
    const history = big.sessions.filter(s => s.date <= '2026-10-16');
    const long = 'PGT_TEST_LARGO_á🙂 https://example.com/video '.repeat(50);
    const sourcePath = root + (field === 'description' ? '/tecnics.json' : '/trainer_comments.json');
    const endpoint = `/api/app/users/${mail}/` + (field === 'description' ? 'techniques' : 'comments');
    const actor = field === 'description' ? f.token : f.trainer;
    const change = async (text: string, sha?: string) => {
        const source = structuredClone(f.files.get(sourcePath)!);
        if (field === 'description') source.data.positions[0].tecnicas[0].descripcion_del_alumno = text;
        else source.data.comments = [{
            techniqueId: f.files.get(root + '/tecnics.json')!.data.positions[0].tecnicas[0].id,
            comment: text
        }];
        return f.call(endpoint, 'PUT', {data: source.data, sha: sha ?? source.sha}, actor);
    };
    const large = await change(long);
    assert.equal(large.status, 200);
    assert.equal(large.body.planIssues.length, 1);
    assert.equal(large.body.planIssues[0].code, 'PLAN_TOO_LARGE');
    assert.ok(large.body.planIssues[0].size.bytes > 4194304);
    assert.deepEqual(f.files.get(bigPath), before);
    const blocked = await f.snapshot();
    assert.equal(blocked.status, 200);
    assert.equal(blocked.body.planIssues.length, 1);
    assert.equal((await f.call('/api/app/login', 'POST', {mail, password: 'synthetic-recovery-password'})).status, 200);
    assert.equal((await change('CONFLICTO', '0'.repeat(40))).status, 409);
    f.fail(409, 'VERSION_CONFLICT');
    const corrected = await change('PGT_TEST_REDUCIDO');
    assert.equal(corrected.status, 200);
    assert.deepEqual(corrected.body.planIssues, []);
    const restored = await f.snapshot();
    assert.equal(restored.status, 200);
    assert.deepEqual(restored.body.planIssues, []);
    const final = restored.body.plans.find((r: any) => r.data.planId === big.planId).data;
    assert.deepEqual(final.sessions.filter((s: any) => s.date <= '2026-10-16'), history);
    assert.ok(final.sessions.filter((s: any) => s.date > '2026-10-16').flatMap((s: any) => s.exercises).every((e: any) => (field === 'description' ? e.descripcion_del_alumno : e.comment) === 'PGT_TEST_REDUCIDO'));
    const stable = JSON.stringify([...f.files]);
    await f.snapshot();
    assert.equal(JSON.stringify([...f.files]), stable);
    assert.equal(JSON.stringify([...f.files].filter(([p]) => p.includes(other))), untouched);
    assert.equal((await f.call(`/api/app/users/${mail}/snapshot`, 'GET', undefined, otherToken)).status, 403);
});
test('BUG-001 empty catalogue and empty positions: restoration stays complete and missing plans remain explicitly pending', async () => {
    for (const positions of [[], [{id: crypto.randomUUID(), posicion: 'Vacía', prioridad: 1, tecnicas: []}]]) {
        const f = await setup();
        const t = f.files.get(root + '/tecnics.json')!;
        const trainable = structuredClone(t.data);
        t.data.positions = positions;
        assert.equal((await f.call('/api/app/competition', 'POST', {
            competition: comp(5),
            sha: null
        }, f.trainer)).status, 200);
        const s = await f.snapshot();
        assert.equal(s.status, 200);
        assert.equal(s.body.profile.data.mail, mail);
        assert.equal(s.body.plans.length, 0);
        assert.equal(s.body.planIssues[0].code, 'NO_TRAINABLE_TECHNIQUES');
        assert.ok(![...f.files.keys()].some(p => p.includes('/training_plans/')));
        const put = await f.call(`/api/app/users/${mail}/techniques`, 'PUT', {data: trainable, sha: t.sha}, f.token);
        assert.equal(put.status, 200);
        const fixed = await f.snapshot();
        assert.equal(fixed.status, 200);
        assert.deepEqual(fixed.body.planIssues, []);
        assert.equal(fixed.body.plans.length, 1);
        assert.ok(fixed.body.plans[0].data.sessions.every((s: any) => s.exercises.length === 5));
        const stable = JSON.stringify([...f.files]);
        await f.snapshot();
        assert.equal(JSON.stringify([...f.files]), stable);
    }
});
test('Recovery never suppresses authorization, provider failures or exhausted SHA conflicts', async () => {
    for (const status of [401, 403, 409, 503]) {
        const f = await setup();
        await f.call('/api/app/competition', 'POST', {competition: comp(1), sha: null}, f.trainer);
        await f.snapshot();
        const t = f.files.get(root + '/tecnics.json')!;
        const data = structuredClone(t.data);
        data.positions[0].tecnicas[0].descripcion_del_alumno = 'Cambio';
        // Persistent failure, not a one-off CAS retry.
        const write = f.cloud.write;
        f.cloud.write = async (p, d, sha) => {
            if (p.includes('/training_plans/')) throw new ApiError(status, 'PROVIDER_FAILURE');
            return write(p, d, sha);
        };
        assert.equal((await f.call(`/api/app/users/${mail}/techniques`, 'PUT', {
            data,
            sha: t.sha
        }, f.token)).status, status);
        assert.equal((await f.snapshot()).status, status);
    }
});
test('Missing oversized plan is pending without a fake file, and can be generated after source correction', async () => {
    const f = await setup();
    const t = f.files.get(root + '/tecnics.json')!;
    t.data.positions[0].tecnicas[0].descripcion_del_alumno = 'Á🙂'.repeat(1200);
    await f.call('/api/app/competition', 'POST', {competition: comp(), sha: null}, f.trainer);
    const blocked = await f.snapshot();
    assert.equal(blocked.status, 200);
    assert.equal(blocked.body.plans.length, 0);
    assert.equal(blocked.body.planIssues[0].code, 'PLAN_TOO_LARGE');
    const data = structuredClone(t.data);
    data.positions[0].tecnicas[0].descripcion_del_alumno = 'Reparado';
    assert.equal((await f.call(`/api/app/users/${mail}/techniques`, 'PUT', {data, sha: t.sha}, f.token)).status, 200);
    const fixed = await f.snapshot();
    assert.equal(fixed.status, 200);
    assert.deepEqual(fixed.body.planIssues, []);
    assert.equal(fixed.body.plans.length, 1);
});
