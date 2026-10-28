import {test} from "node:test";
import assert from "node:assert/strict";
import {AppApi} from "../worker/application.ts";
import {ApiError} from "../worker/security.ts";
import {template} from "./template-fixture.ts";
import type {CloudStorageProvider, CloudRecord} from "../worker/storage.ts";

function fixture() {
    const files = new Map<string, CloudRecord<any>>([
        [
            "PGT/master_data/tecnics_base.json",
            {data: structuredClone(template), sha: "1".repeat(40)},
        ],
    ]);
    const sessions = new Map<string, unknown>();
    const reads: string[] = [];
    let revision = 1,
        failure = 0;
    const storage = {
        get: async (k: string) => sessions.get(k),
        put: async (k: string, v: unknown) => {
            sessions.set(k, v);
        },
        delete: async (k: string) => sessions.delete(k),
        list: async ({prefix}: { prefix: string }) =>
            new Map([...sessions].filter(([k]) => k.startsWith(prefix))),
    };
    const cloud: CloudStorageProvider = {
        verifyPrivate: async () => {
        },
        read: async <T>(p: string) => {
            reads.push(p);
            return (files.get(p) as CloudRecord<T>) || null;
        },
        write: async (p, data, sha) => {
            if (p.includes("/training_plans/") && failure) {
                const status = failure;
                failure = 0;
                throw new ApiError(status, "INJECTED_PLAN_FAILURE");
            }
            if ((files.get(p)?.sha ?? null) !== sha)
                throw new ApiError(409, "VERSION_CONFLICT");
            const next = (++revision).toString(16).padStart(40, "0");
            files.set(p, {data: structuredClone(data), sha: next});
            return next;
        },
        remove: async (p) => {
            files.delete(p);
        },
        list: async (dir) =>
            [
                ...new Set(
                    [...files.keys()]
                        .filter((p) => p.startsWith(dir + "/"))
                        .map((p) => p.slice(dir.length + 1).split("/")[0]),
                ),
            ].map((name) => ({
                name,
                type: name.endsWith(".json") ? "file" : "dir",
                sha: files.get(dir + "/" + name)?.sha,
            })),
    };
    let instant = new Date("2026-10-13T22:30:00Z");
    const api = new AppApi(
        storage as unknown as DurableObjectStorage,
        cloud,
        () => instant,
    );

    async function call(
        path: string,
        method: string,
        body?: unknown,
        token = "",
    ) {
        const req = new Request("https://fixture" + path, {
            method,
            headers: {
                Authorization: "Bearer " + token,
                "Content-Type": "application/json",
            },
            body: body ? JSON.stringify(body) : undefined,
        });
        try {
            return await api.handle(req, new URL(req.url));
        } catch (e) {
            if (e instanceof ApiError)
                return Response.json({error: e.message}, {status: e.status});
            throw e;
        }
    }

    async function register(mail: string) {
        const r = await call("/api/app/register", "POST", {
            mail,
            password: "synthetic-test-password",
            confirm: "synthetic-test-password",
            nombre: "Fixture",
            apellidos: "",
        });
        assert.equal(r.status, 201);
        return ((await r.json()) as any).token;
    }

    return {
        files,
        reads,
        setDate: (date: string) => {
            instant = new Date(date + "T10:00:00Z");
        },
        call,
        register,
        fail: (status: number) => {
            failure = status;
        },
    };
}

test("Future text sync persists to GitHub adapter, recovers partial failures, isolates students and preserves closed plans", async () => {
    const f = fixture(),
        a = "a@example.com",
        b = "b@example.com";
    const aToken = await f.register(a),
        bToken = await f.register(b);
    await f.register("coach@example.com");
    f.files.get("PGT/users_data/coach@example.com/user_data.json")!.data.perfil = "entrenador";
    const trainer = (
        (await (
            await f.call("/api/app/login", "POST", {
                mail: "coach@example.com",
                password: "synthetic-test-password",
            })
        ).json()) as any
    ).token;
    let catalogSha: string | null = null;
    for (const tournament of ["2026-12-13", "2026-10-14"]) {
        const competition = {
            fecha_comienzo: "2026-10-08",
            fecha_torneo: tournament,
            dias_de_entrenamiento: [2, 4],
            ejercicios_por_sesion: 5,
            tiempo_por_tecnica_segundos: 180,
            descanso_entre_ciclos_segundos: 10,
            descanso_entre_tecnicas_segundos: 20,
            alumnos: [a, b],
        };
        assert.equal(
            (
                await f.call(
                    "/api/app/competition",
                    "POST",
                    {competition, sha: catalogSha},
                    trainer,
                )
            ).status,
            200,
        );
        catalogSha = f.files.get("PGT/master_data/plans.json")!.sha;
    }
    const path = `/api/app/users/${a}/`,
        snapshot = async () =>
            (await (
                await f.call(path + "snapshot", "GET", undefined, aToken)
            ).json()) as any;
    let snap = await snapshot();
    await f.call(`/api/app/users/${b}/snapshot`, "GET", undefined, bToken);
    const active = snap.plans.find(
            (p: any) => p.data.fecha_torneo === "2026-12-13",
        ),
        ended = snap.plans.find((p: any) => p.data.fecha_torneo === "2026-10-14");
    const before = structuredClone(active.data),
        other = JSON.stringify(
            [...f.files].filter(([k]) => k.includes(`/users_data/${b}/`)),
        ),
        id = snap.techniques.data.positions[0].tecnicas[0].id;
    const techniques = structuredClone(snap.techniques.data);
    techniques.positions[0].tecnicas[0].descripcion_del_alumno =
        "Nueva preferida";
    f.fail(503);
    assert.equal(
        (
            await f.call(
                path + "techniques",
                "PUT",
                {data: techniques, sha: snap.techniques.sha},
                aToken,
            )
        ).status,
        503,
    );
    assert.equal(
        f.files.get(`PGT/users_data/${a}/tecnics.json`)!.data.positions[0]
            .tecnicas[0].descripcion_del_alumno,
        "Nueva preferida",
    );
    // Source and version are already durable. Snapshot heals the interrupted fan-out.
    snap = await snapshot();
    let updated = snap.plans.find(
        (p: any) => p.data.planId === active.data.planId,
    );
    assert.deepEqual(
        snap.plans.find((p: any) => p.data.planId === ended.data.planId),
        ended,
    );
    assert.deepEqual(
        updated.data.sessions.filter((s: any) => s.date <= "2026-10-14"),
        before.sessions.filter((s: any) => s.date <= "2026-10-14"),
    );
    let occurrences = 0;
    for (const s of updated.data.sessions)
        if (s.date > "2026-10-14")
            for (const e of s.exercises)
                if (e.techniqueId === id) {
                    occurrences++;
                    assert.equal(e.descripcion_del_alumno, "Nueva preferida");
                }
    assert.ok(occurrences > 1);
    assert.equal(
        JSON.stringify(
            [...f.files].filter(([k]) => k.includes(`/users_data/${b}/`)),
        ),
        other,
    );
    f.fail(409); // CAS failure must refetch the plan and retry, never last-writer-win.
    const notes = {
        ...snap.comments.data,
        comments: [{techniqueId: id, comment: "Consejo futuro"}],
    };
    assert.equal(
        (
            await f.call(
                path + "comments",
                "PUT",
                {data: notes, sha: snap.comments.sha},
                trainer,
            )
        ).status,
        200,
    );
    snap = await snapshot();
    updated = snap.plans.find((p: any) => p.data.planId === active.data.planId);
    for (const s of updated.data.sessions)
        for (const e of s.exercises)
            if (e.techniqueId === id)
                assert.equal(e.comment, s.date > "2026-10-14" ? "Consejo futuro" : "");
    const unchanged = JSON.stringify(updated);
    assert.equal(
        JSON.stringify(
            (await snapshot()).plans.find(
                (p: any) => p.data.planId === active.data.planId,
            ),
        ),
        unchanged,
    );
    const manual = structuredClone(updated.data),
        future = manual.sessions.find(
            (s: any) =>
                s.date > "2026-10-14" &&
                s.exercises.some((e: any) => e.techniqueId === id),
        );
    manual.appliedDescriptionUpdates = {[id]: "forged"};
    future.exercises.find(
        (e: any) => e.techniqueId === id,
    ).descripcion_del_alumno = "Manual posterior";
    assert.equal(
        (
            await f.call(
                path + "plan",
                "PUT",
                {data: manual, sha: updated.sha},
                aToken,
            )
        ).status,
        403,
    );
    snap = await snapshot();
    assert.equal(
        snap.plans
            .find((p: any) => p.data.planId === active.data.planId)
            .data.sessions.find((s: any) => s.date === future.date)
            .exercises.find((e: any) => e.techniqueId === id).descripcion_del_alumno,
        "Nueva preferida",
    );
    assert.equal(
        (
            await f.call(
                path + "comments",
                "PUT",
                {data: notes, sha: snap.comments.sha},
                aToken,
            )
        ).status,
        403,
    );
    // Additions alone do not silently activate the structural algorithm under analysis.
    const newTech = structuredClone(snap.techniques.data);
    newTech.positions[0].tecnicas.push({
        id: crypto.randomUUID(),
        tipo: "Nueva",
        descripcion_del_alumno: "",
    });
    const plansBefore = JSON.stringify(snap.plans);
    assert.equal(
        (
            await f.call(
                path + "techniques",
                "PUT",
                {data: newTech, sha: snap.techniques.sha},
                aToken,
            )
        ).status,
        200,
    );
    assert.equal(JSON.stringify((await snapshot()).plans), plansBefore);
    snap = await snapshot();
    const beforeRecovery = snap.plans.find(
        (p: any) => p.data.planId === active.data.planId,
    ).data;
    const recoveryDate = beforeRecovery.sessions.find(
        (s: any) =>
            s.date > "2026-10-14" &&
            s.exercises.some((e: any) => e.techniqueId === id),
    ).date;
    const delayed = structuredClone(snap.techniques.data);
    delayed.positions
        .flatMap((p: any) => p.tecnicas)
        .find((t: any) => t.id === id).descripcion_del_alumno =
        "Segunda actualización";
    f.fail(503);
    assert.equal(
        (
            await f.call(
                path + "techniques",
                "PUT",
                {data: delayed, sha: snap.techniques.sha},
                aToken,
            )
        ).status,
        503,
    );
    f.setDate(recoveryDate);
    const recovered = (await snapshot()).plans.find(
        (p: any) => p.data.planId === active.data.planId,
    ).data;
    assert.deepEqual(
        recovered.sessions.filter((s: any) => s.date <= recoveryDate),
        beforeRecovery.sessions.filter((s: any) => s.date <= recoveryDate),
    );
    assert.ok(
        recovered.sessions.some(
            (s: any) =>
                s.date > recoveryDate &&
                s.exercises.some(
                    (e: any) =>
                        e.techniqueId === id &&
                        e.descripcion_del_alumno === "Segunda actualización",
                ),
        ),
    );
});

test('Deletion fan-out updates every active student plan, recovers CAS/interrupted writes, ignores forged tombstones, and retains blocked plans', async () => {
    const f = fixture(), a = 'delete-a@example.com', b = 'delete-b@example.com';
    const token = await f.register(a), otherToken = await f.register(b);
    await f.register('delete-coach@example.com');
    f.files.get('PGT/users_data/delete-coach@example.com/user_data.json')!.data.perfil = 'entrenador';
    const coach = (await (await f.call('/api/app/login', 'POST', {
        mail: 'delete-coach@example.com',
        password: 'synthetic-test-password'
    })).json() as any).token;
    let sha: string | null = null;
    for (const fecha_torneo of ['2026-12-13', '2026-12-20', '2026-10-14']) {
        const r = await f.call('/api/app/competition', 'POST', {
            sha,
            competition: {
                fecha_comienzo: '2026-10-08',
                fecha_torneo,
                dias_de_entrenamiento: [2, 4],
                ejercicios_por_sesion: 5,
                tiempo_por_tecnica_segundos: 180,
                descanso_entre_ciclos_segundos: 5,
                descanso_entre_tecnicas_segundos: 20,
                alumnos: [a, b]
            }
        }, coach);
        assert.equal(r.status, 200);
        sha = f.files.get('PGT/master_data/plans.json')!.sha;
    }
    const path = `/api/app/users/${a}/`,
        snapshot = async () => await (await f.call(path + 'snapshot', 'GET', undefined, token)).json() as any;
    let snap = await snapshot();
    await f.call(`/api/app/users/${b}/snapshot`, 'GET', undefined, otherToken);
    const originals = structuredClone(snap.plans),
        others = JSON.stringify([...f.files].filter(([p]) => p.includes(`/users_data/${b}/`)));
    const next = structuredClone(snap.techniques.data), deleted = next.positions[0].tecnicas.pop().id;
    next.deletedIds = ['forged'];
    f.fail(409);
    assert.equal((await f.call(path + 'techniques', 'PUT', {data: next, sha: snap.techniques.sha}, token)).status, 200);
    snap = await snapshot();
    assert.ok(snap.techniques.data.deletedIds.includes(deleted));
    assert.ok(!snap.techniques.data.deletedIds.includes('forged'));
    for (const p of snap.plans) {
        const original = originals.find((o: any) => o.data.planId === p.data.planId);
        if (p.data.fecha_torneo <= '2026-10-14') assert.deepEqual(p, original);
        else {
            assert.deepEqual(p.data.sessions.filter((s: any) => s.date <= '2026-10-14'), original.data.sessions.filter((s: any) => s.date <= '2026-10-14'));
            assert.ok(p.data.sessions.filter((s: any) => s.date > '2026-10-14').every((s: any) => s.exercises.length === 5 && s.exercises.every((e: any) => e.techniqueId !== deleted)));
        }
    }
    const removedPosition = snap.techniques.data.positions[0].id, second = structuredClone(snap.techniques.data);
    second.positions.shift();
    second.deletedIds = [];
    f.fail(503);
    assert.equal((await f.call(path + 'techniques', 'PUT', {
        data: second,
        sha: snap.techniques.sha
    }, token)).status, 503);
    assert.ok(f.files.get(`PGT/users_data/${a}/tecnics.json`)!.data.deletedIds.includes(removedPosition));
    snap = await snapshot();
    for (const p of snap.plans.filter((p: any) => p.data.fecha_torneo > '2026-10-14')) assert.ok(p.data.sessions.filter((s: any) => s.date > '2026-10-14').every((s: any) => s.exercises.every((e: any) => e.positionId !== removedPosition && e.techniqueId !== deleted)));
    const stable = JSON.stringify(snap.plans);
    assert.equal(JSON.stringify((await snapshot()).plans), stable);
    assert.equal(JSON.stringify([...f.files].filter(([p]) => p.includes(`/users_data/${b}/`))), others);
    const empty = {...snap.techniques.data, positions: []};
    assert.equal((await f.call(path + 'techniques', 'PUT', {
        data: empty,
        sha: snap.techniques.sha
    }, token)).status, 200);
    const blocked = await snapshot();
    for (const p of blocked.plans.filter((p: any) => p.data.fecha_torneo > '2026-10-14')) {
        assert.match(p.data.structuralUpdateError, /No quedan técnicas/);
        assert.deepEqual(p.data.sessions, snap.plans.find((n: any) => n.data.planId === p.data.planId).data.sessions);
    }
    assert.equal(JSON.stringify((await snapshot()).plans), JSON.stringify(blocked.plans));
});

test("Trainer section views avoid unrelated documents, unchanged downloads and repeated plan updates, with live authorization", async () => {
    const f = fixture(), mail = 'view@example.com';
    const pupil = await f.register(mail);
    await f.register('viewer@example.com');
    f.files.get('PGT/users_data/viewer@example.com/user_data.json')!.data.perfil = 'entrenador';
    const coach = (await (await f.call('/api/app/login', 'POST', {
        mail: 'viewer@example.com',
        password: 'synthetic-test-password'
    })).json() as any).token;
    const base = `/api/app/users/${mail}/view`;
    assert.equal((await f.call(base + '?section=techniques', 'GET', undefined, pupil)).status, 403);
    assert.equal((await f.call(base + '?section=invalid', 'GET', undefined, coach)).status, 400);
    f.reads.length = 0;
    const first = await (await f.call(base + '?section=techniques', 'GET', undefined, coach)).json() as any;
    assert.ok(first.techniques && first.comments);
    assert.equal(first.plans, undefined);
    assert.ok(!f.reads.some(p => p.includes('/training_plans/') || p.endsWith('/plans_index.json') || p.endsWith('/plans.json')));
    const known = {profile: first.profile.sha, techniques: first.techniques.sha, comments: first.comments.sha};
    f.reads.length = 0;
    const second = await (await f.call(base + '?section=techniques&known=' + encodeURIComponent(JSON.stringify(known)), 'GET', undefined, coach)).json() as any;
    assert.ok(second.techniques.unchanged && second.comments.unchanged);
    assert.ok(!f.reads.some(p => p.endsWith('/tecnics.json') || p.endsWith('/trainer_comments.json')));
    const before = JSON.stringify([...f.files]);
    f.reads.length = 0;
    const admin = await (await f.call(base + '?section=administration', 'GET', undefined, coach)).json() as any;
    assert.ok(admin.profile);
    assert.equal(admin.techniques, undefined);
    assert.equal(admin.plans, undefined);
    assert.equal(JSON.stringify([...f.files]), before);
    // Different pupil identities have distinct source data; current role is checked each request.
    assert.equal((await f.call('/api/app/users/viewer@example.com/view?section=administration', 'GET', undefined, coach)).status, 200);
    f.files.get('PGT/users_data/viewer@example.com/user_data.json')!.data.perfil = 'alumno';
    assert.equal((await f.call(base + '?section=plans', 'GET', undefined, coach)).status, 403);
});

test('Twenty-plan manifest downloads no plan JSON; selected detail repairs only itself and repeated SHA reads skip processing', async () => {
    const {generatePlan} = await import('../src/domain/planner.ts');
    const f = fixture(), mail = 'many-plans@example.com';
    await f.register(mail);
    await f.register('plans-coach@example.com');
    f.files.get('PGT/users_data/plans-coach@example.com/user_data.json')!.data.perfil = 'entrenador';
    const token = (await (await f.call('/api/app/login', 'POST', {
        mail: 'plans-coach@example.com',
        password: 'synthetic-test-password'
    })).json() as any).token;
    const root = `PGT/users_data/${mail}`, t = f.files.get(root + '/tecnics.json')!.data,
        notes = f.files.get(root + '/trainer_comments.json')!.data;
    const plans = Array.from({length: 20}, () => generatePlan({
        planId: crypto.randomUUID(),
        alumnos: [mail],
        fecha_comienzo: '2026-10-08',
        fecha_torneo: '2026-12-13',
        dias_de_entrenamiento: [2, 4],
        ejercicios_por_sesion: 5,
        tiempo_por_tecnica_segundos: 180,
        descanso_entre_ciclos_segundos: 5,
        descanso_entre_tecnicas_segundos: 20
    }, mail, t, notes, '2026-10-01T00:00:00Z'));
    for (const p of plans) f.files.set(root + `/training_plans/plan_${p.planId}.json`, {
        data: p,
        sha: crypto.randomUUID().replaceAll('-', '').padEnd(40, '0')
    });
    const base = `/api/app/users/${mail}/view?section=plans`;
    f.reads.length = 0;
    const list = await (await f.call(base, 'GET', undefined, token)).json() as any;
    assert.equal(list.planSummaries.length, 20);
    assert.deepEqual(list.plans, []);
    assert.ok(!f.reads.some(p => p.includes('/training_plans/')));
    const id = t.positions[0].tecnicas[0].id;
    t.positions[0].tecnicas[0].descripcion_del_alumno = 'Changed';
    t.descriptionUpdates = {[id]: 'd2'};
    f.files.get(root + '/tecnics.json')!.sha = 'b'.repeat(40);
    const other = JSON.stringify(plans[1]);
    f.reads.length = 0;
    const detail = await (await f.call(base + '&planId=' + plans[0].planId, 'GET', undefined, token)).json() as any;
    assert.equal(detail.plans.length, 1);
    assert.equal(detail.plans[0].data.planId, plans[0].planId);
    assert.deepEqual(detail.plans[0].data.sessions.filter((s: any) => s.date <= '2026-10-14'), plans[0].sessions.filter(s => s.date <= '2026-10-14'));
    assert.equal(JSON.stringify(f.files.get(root + `/training_plans/plan_${plans[1].planId}.json`)!.data), other);
    assert.ok(f.reads.filter(p => p.includes('/training_plans/')).every(p => p.endsWith(`plan_${plans[0].planId}.json`)));
    const known = {['plan:' + plans[0].planId]: detail.plans[0].sha};
    f.reads.length = 0;
    const repeated = await (await f.call(base + '&planId=' + plans[0].planId + '&known=' + encodeURIComponent(JSON.stringify(known)), 'GET', undefined, token)).json() as any;
    assert.ok(repeated.plans[0].unchanged);
    assert.ok(!f.reads.some(p => p.includes('/training_plans/') || p.endsWith('/tecnics.json') || p.endsWith('/trainer_comments.json')));
    const absent = await f.call(base + '&planId=' + crypto.randomUUID(), 'GET', undefined, token);
    assert.equal(absent.status, 404);
});
