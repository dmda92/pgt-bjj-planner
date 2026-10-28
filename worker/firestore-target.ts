import { ApiError } from './security.ts';
export interface FirestoreTargetEnv {
    FIRESTORE_ENVIRONMENT?: string; FIRESTORE_PROJECT_ID?: string; FIRESTORE_DATABASE_ID?: string;
    FIRESTORE_SERVICE_ACCOUNT_EMAIL?: string;
}
export type FirestoreTarget = Readonly<{ environment: 'dev' | 'pro'; project: string; database: string; databaseName: string; serviceAccountEmail: string }>;
export const LEGACY_DEV_TARGET: FirestoreTarget = Object.freeze({ environment: 'dev', project: 'pgt-bjj-dev', database: '(default)', databaseName: 'projects/pgt-bjj-dev/databases/(default)', serviceAccountEmail: 'pgt-worker-dev@pgt-bjj-dev.iam.gserviceaccount.com' });
/** Server configuration only. Never derive a target from a request or migration payload. */
export function resolveFirestoreTarget(env: FirestoreTargetEnv, options: { legacyDev?: boolean } = {}): FirestoreTarget {
    if (options.legacyDev && env.FIRESTORE_ENVIRONMENT === undefined && env.FIRESTORE_SERVICE_ACCOUNT_EMAIL === undefined && env.FIRESTORE_PROJECT_ID === LEGACY_DEV_TARGET.project && env.FIRESTORE_DATABASE_ID === LEGACY_DEV_TARGET.database) return LEGACY_DEV_TARGET;
    const environment = env.FIRESTORE_ENVIRONMENT;
    if (environment !== 'dev' && environment !== 'pro') throw new ApiError(503, 'FIRESTORE_ENVIRONMENT_REQUIRED');
    const project = environment === 'dev' ? 'pgt-bjj-dev' : 'pgt-bjj-pro';
    if (env.FIRESTORE_PROJECT_ID !== project || env.FIRESTORE_DATABASE_ID !== '(default)') throw new ApiError(503, 'FIRESTORE_TARGET_MISMATCH');
    const email = env.FIRESTORE_SERVICE_ACCOUNT_EMAIL;
    if (typeof email !== 'string' || !new RegExp('^[a-z][a-z0-9-]{4,62}@' + project + '\\.iam\\.gserviceaccount\\.com$').test(email)) throw new ApiError(503, 'FIRESTORE_PRINCIPAL_REQUIRED');
    return Object.freeze({ environment, project, database: '(default)', databaseName: `projects/${project}/databases/(default)`, serviceAccountEmail: email });
}
