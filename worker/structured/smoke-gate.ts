import {ApiError} from '../security.ts';

export const smokeLimits = Object.freeze({reads: 200, writes: 150, deletes: 50, users: 2});

export function checkSmokeGate(evidence: any, plan: any, {now = Date.now(), build}: {
    now?: number;
    build?: string
} = {}) {
    const reject = (code: string): never => {
        throw new ApiError(409, code);
    };
    if (evidence?.project !== 'pgt-bjj-dev' || plan?.project !== 'pgt-bjj-dev') reject('DEV_PROJECT_REQUIRED');
    const age = now - Date.parse(evidence.observedAt);
    if (!Number.isFinite(age) || age < 0 || age > 10 * 60 * 1000 || evidence.source !== 'cloud-firestore-api-quota-current-period') reject('RELIABLE_FRESH_QUOTA_REQUIRED');
    if (!build || plan.build !== build || plan.measuredLocally !== true || plan.includesCleanup !== true) reject('CURRENT_LOCAL_COST_PLAN_REQUIRED');
    for (const [key, free] of [['reads', 50000], ['writes', 20000], ['deletes', 20000]] as const) {
        const used = evidence.used?.[key], cost = plan.total?.[key];
        if (!Number.isSafeInteger(used) || used < 0 || !Number.isSafeInteger(cost) || cost < 0 || cost > smokeLimits[key]) reject('DEV_TEST_BUDGET_INVALID');
        if (used >= free * .8 || used + cost >= free * .8) reject('DEV_QUOTA_TOO_CLOSE_TO_LIMIT');
    }
    if (!Number.isSafeInteger(plan.users) || plan.users < 1 || plan.users > smokeLimits.users) reject('DEV_SYNTHETIC_USER_LIMIT');
    if (plan.realExecutionsForBuild !== 0) reject('DEV_REAL_EXECUTION_ALREADY_RECORDED');
    return {...smokeLimits};
}
