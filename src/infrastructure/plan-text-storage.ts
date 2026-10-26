import type { PlanTextProjection } from './plan-text-projection.ts';
type Appearance = PlanTextProjection['appearances'][number];
type PackedText = { projection: Omit<PlanTextProjection, 'appearances'>; dates: string[];
    groups: (Omit<Appearance, 'date'> & { dates: number[]; ordinals: number[] })[] };
/** Deduplicate UUIDs and dates physically while keeping the projection's exact order. */
export function packPlanText(value: PlanTextProjection): PackedText {
    const { appearances, ...projection } = value, dates: string[] = [], dateIds = new Map<string, number>();
    const groups: PackedText['groups'] = [], ids = new Map<string, number>();
    for (const [ordinal, a] of appearances.entries()) {
        let date = dateIds.get(a.date);
        if (date === undefined) { date = dates.length; dates.push(a.date); dateIds.set(a.date, date); }
        const key = JSON.stringify([a.positionId, a.techniqueId, a.value, a.count]);
        let id = ids.get(key);
        if (id === undefined) {
            id = groups.length; ids.set(key, id);
            groups.push({ positionId: a.positionId, techniqueId: a.techniqueId, value: a.value, count: a.count, dates: [], ordinals: [] });
        }
        groups[id].dates.push(date); groups[id].ordinals.push(ordinal);
    }
    return { projection, dates, groups };
}
export function unpackPlanText(value: PackedText): PlanTextProjection {
    const appearances: Appearance[] = [];
    for (const g of value.groups) {
        if (g.dates.length !== g.ordinals.length) throw Error('PLAN_TEXT_STORAGE_CORRUPT');
        for (const [i, date] of g.dates.entries()) {
            const ordinal = g.ordinals[i];
            if (!Number.isSafeInteger(ordinal) || ordinal < 0 || appearances[ordinal] || typeof value.dates[date] !== 'string') throw Error('PLAN_TEXT_STORAGE_CORRUPT');
            appearances[ordinal] = { date: value.dates[date], positionId: g.positionId, techniqueId: g.techniqueId, value: g.value, count: g.count };
        }
    }
    if (Object.keys(appearances).length !== appearances.length) throw Error('PLAN_TEXT_STORAGE_CORRUPT');
    return { ...value.projection, appearances };
}
