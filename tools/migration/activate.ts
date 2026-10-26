import { verifyBundle, type MigrationBundle } from './convert.ts';
import { NativeFirestore } from '../../worker/structured/firestore.ts';
import { NativeAggregates } from '../../worker/v2/aggregates.ts';
import { nativeWrite } from '../../worker/v2/plans.ts';
import { normalizedMail, passwordHash, passwordMatches } from '../../worker/security.ts';
import { blockDigest } from '../../src/infrastructure/native-packing.ts';
import type { Profile } from '../../src/domain/models.ts';

/** Supplied by a trusted operator runner using the shared durable budget, maintenance
 * window and current quota evidence. There is deliberately no public HTTP/CLI runner
 * that can turn request fields into this capability. */
export interface ActivationGate { authorize(checksum: string, namespace: string): Promise<void> }
export async function activateDevMigration(bundle: MigrationBundle, db: NativeFirestore, gate: ActivationGate,
    credentials: Readonly<Record<string, string>>, expectedPointer: string | null) {
    verifyBundle(bundle);
    if (bundle.target !== 'pgt-bjj-dev' || !bundle.ready || !db.usage.budget) throw Error('MIGRATION_ACTIVATION_NOT_AUTHORIZED');
    const namespace = 'pgt_v2/import-' + bundle.checksum.slice(0, 24);
    await gate.authorize(bundle.checksum, namespace);
    const control = await db.get('pgt_v2/control', true), root = await db.get(namespace, true);
    if (!root || root.data.phase !== 'verified' || root.data.bundleChecksum !== bundle.checksum ||
        root.data.sourceCommit !== bundle.source.commit) throw Error('MIGRATION_IMPORT_NOT_VERIFIED');
    if (control?.data.namespace === namespace && control.data.bundleChecksum === bundle.checksum && root.data.active === true)
        return { namespace, status: 'already-active' as const };
    if ((control?.updateTime ?? null) !== expectedPointer || root.data.active !== false) throw Error('MIGRATION_ACTIVATION_CONFLICT');
    const users = new Map(bundle.users.map(u => [u.profile.mail, u.profile]));
    for (const [mail, password] of Object.entries(credentials))
        if (normalizedMail(mail) !== mail || !users.has(mail) || typeof password !== 'string' || password.length < 12 || password.length > 128)
            throw Error('MIGRATION_DEV_CREDENTIAL_INVALID');
    const trainers = bundle.users.filter(u => u.profile.perfil === 'entrenador');
    if (!trainers.length || trainers.some(u => !credentials[u.profile.mail])) throw Error('MIGRATION_DEV_TRAINER_CREDENTIAL_REQUIRED');
    const store = new NativeAggregates(db, namespace), prepared = [];
    // Validate every current profile and hash all supplied passwords before the first mutation.
    for (const [mail, password] of Object.entries(credentials)) {
        const ref = { kind: 'profile' as const, id: mail }, profile = await store.read<Profile>(ref);
        if (!profile || profile.data.mail !== mail || profile.data.perfil !== users.get(mail)!.perfil) throw Error('MIGRATION_DEV_ACCOUNT_MISMATCH');
        if (profile.data.pwd) {
            if (!await passwordMatches(password, profile.data.pwd)) throw Error('MIGRATION_DEV_CREDENTIAL_CONFLICT');
        } else prepared.push({ ref, expected: profile.version, data: { ...profile.data, pwd: await passwordHash(password) } });
    }
    for (const p of prepared) {
        const h = blockDigest([bundle.checksum, p.ref.id, p.data.pwd]).slice(0, 32);
        const id = h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
        await store.write(p.ref, p.data, p.expected, id);
    }
    await gate.authorize(bundle.checksum, namespace);
    // The pointer and active marker become visible together. No old namespace is deleted.
    await db.commit([
        nativeWrite(db, namespace, { ...root.data, active: true }, root),
        nativeWrite(db, 'pgt_v2/control', { phase: 'active', project: 'pgt-bjj-dev', namespace,
            sourceCommit: bundle.source.commit, bundleChecksum: bundle.checksum }, control)
    ]);
    return { namespace, status: 'activated' as const };
}
