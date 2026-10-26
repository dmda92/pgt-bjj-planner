import type { TrainingPlan } from '../../src/domain/models.ts';
import { validDate } from '../../src/domain/models.ts';
import { materializePlanSlice, type PlanTextProjection } from '../../src/infrastructure/plan-text-projection.ts';
import { ApiError, normalizedMail } from '../security.ts';
import { NativeAggregates } from './aggregates.ts';
import { PlanRepository } from './plans.ts';

/** Authorized callers only. GET-style materialization has no reconciliation, generation,
 * flush, writes or dependency reads from live repertoires/comments.
 */
export class PlanViews {
    readonly plans: PlanRepository;
    readonly aggregates: NativeAggregates;
    constructor(plans: PlanRepository, aggregates: NativeAggregates) {
        if (plans.db !== aggregates.db || plans.namespace !== aggregates.namespace)
            throw Error('PLAN_VIEW_STORE_MISMATCH');
        this.plans = plans;
        this.aggregates = aggregates;
    }
    async read(owner: string, planId: string, date?: string,
        head?: Awaited<ReturnType<PlanRepository['head']>>, binding?: { data: PlanTextProjection; version: string } | null): Promise<{
        data: TrainingPlan; version: { distribution: string; text: string };
    } | null> {
        owner = normalizedMail(owner);
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(planId))
            throw new ApiError(400, 'PLAN_ID_INVALID');
        if (date !== undefined && !validDate(date)) throw new ApiError(400, 'DATE_INVALID');
        planId = planId.toLowerCase();
        const base = await this.plans.read(owner, planId, date, head);
        if (!base) return null;
        const text = binding === undefined ? await this.aggregates.read<PlanTextProjection>({ kind: 'plan-text', id: planId + '__' + owner }) : binding;
        if (!text) throw new ApiError(409, 'PLAN_TEXT_NOT_PUBLISHED');
        try {
            if (text.data.format !== 'pgt-plan-text-v2') throw Error();
            return { data: materializePlanSlice(base.data, text.data, base.baseHash),
                version: { distribution: base.version, text: text.version } };
        } catch {
            // A concurrent structural publication must be retried by the coordinator;
            // no read is permitted to repair it or expose a mixed-generation view.
            throw new ApiError(409, 'PLAN_VIEW_REVISION_MISMATCH');
        }
    }
}
