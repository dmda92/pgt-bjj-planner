import type { TrainingPlan } from '../domain/models.ts';
import { validDate } from '../domain/models.ts';
import { trainingDay, type TrainingDay, type StructureIndex } from '../domain/trainer-reports.ts';
type Calendar = {
    owner: string;
    planId: string;
    start: string;
    end: string;
    blocked: boolean;
    dateSet: number;
};
type Contribution = {
    date: string;
    owner: string;
    planId: string;
    pattern: number;
};
export interface MonthlyAgenda {
    format: 'pgt-trainer-month-v2';
    month: string;
    labels: {
        position: string;
        type: string;
    }[];
    patterns: {
        items: number[];
    }[];
    dateSets: {
        dates: string[];
    }[];
    calendars: Calendar[];
    contributions: Contribution[];
    pending: {
        owner: string;
        planId: string;
        start: string;
        end: string;
    }[];
}
/** Replace exactly one participant's contribution. No other plan or month is loaded.
 * Re-intern dictionaries to avoid keeping removed names or unbounded dead patterns. */
export function replaceAgendaPlan(current: MonthlyAgenda, owner: string, planId: string, plan: TrainingPlan | null,
    pending?: MonthlyAgenda['pending'][number]): MonthlyAgenda {
    if (plan && (plan.mail !== owner || plan.planId !== planId)) throw Error('AGENDA_IDENTITY_INVALID');
    const incoming = plan ? buildMonthlyAgenda([plan], current.month) : buildMonthlyAgenda([], current.month);
    const identity = (c: { owner: string; planId: string }) => c.owner === owner && c.planId === planId;
    const result = buildMonthlyAgenda([], current.month), order = current.calendars.map(c => ({ source: current, calendar: c }));
    const index = order.findIndex(v => identity(v.calendar));
    if (index >= 0) order.splice(index, 1, ...incoming.calendars.map(calendar => ({ source: incoming, calendar })));
    else order.push(...incoming.calendars.map(calendar => ({ source: incoming, calendar })));
    const labels = new Map<string, number>(), patterns = new Map<string, number>(), dateSets = new Map<string, number>();
    for (const { source, calendar } of order) {
        const dates = source.dateSets[calendar.dateSet], dateKey = JSON.stringify(dates);
        let dateSet = dateSets.get(dateKey);
        if (dateSet === undefined) { dateSet = result.dateSets.length; dateSets.set(dateKey, dateSet); result.dateSets.push(structuredClone(dates)); }
        result.calendars.push({ ...calendar, dateSet });
        for (const c of source.contributions.filter(c => c.owner === calendar.owner && c.planId === calendar.planId)) {
            const items = source.patterns[c.pattern].items.map(id => {
                const value = source.labels[id], key = JSON.stringify(value);
                let target = labels.get(key);
                if (target === undefined) { target = result.labels.length; labels.set(key, target); result.labels.push({ ...value }); }
                return target;
            });
            const key = JSON.stringify(items); let pattern = patterns.get(key);
            if (pattern === undefined) { pattern = result.patterns.length; patterns.set(key, pattern); result.patterns.push({ items }); }
            result.contributions.push({ ...c, pattern });
        }
    }
    result.pending = current.pending.filter(c => !identity(c)).map(c => ({ ...c }));
    if (pending) result.pending.push({ ...pending });
    return result;
}
/** Built from stored plan snapshots when assignment, structure or labels change.
 * Description/comment mutations do not affect this view.
 */
export function buildMonthlyAgenda(plans: TrainingPlan[], month: string, pending: MonthlyAgenda['pending'] = []): MonthlyAgenda {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
        throw Error('MONTH_INVALID');
    const result: MonthlyAgenda = { format: 'pgt-trainer-month-v2', month, labels: [], patterns: [], dateSets: [], calendars: [], contributions: [], pending: structuredClone(pending) };
    const labels = new Map<string, number>(), patterns = new Map<string, number>(), dates = new Map<string, number>(), seen = new Set<string>();
    for (const plan of plans) {
        const identity = JSON.stringify([plan.mail, plan.planId]);
        if (seen.has(identity))
            throw Error('AGENDA_DUPLICATE_PLAN');
        seen.add(identity);
        const calendar = plan.sessions.map(s => s.date), dateKey = JSON.stringify(calendar);
        let dateSet = dates.get(dateKey);
        if (dateSet === undefined) {
            dateSet = result.dateSets.length;
            dates.set(dateKey, dateSet);
            result.dateSets.push({ dates: calendar });
        }
        result.calendars.push({ owner: plan.mail, planId: plan.planId, start: plan.fecha_comienzo, end: plan.fecha_torneo, blocked: Boolean(plan.structuralUpdateError), dateSet });
        for (const s of plan.sessions) {
            if (s.date.slice(0, 7) !== month)
                continue;
            const items = s.exercises.map(e => {
                const key = JSON.stringify([e.posicion, e.tipo]);
                let id = labels.get(key);
                if (id === undefined) {
                    id = result.labels.length;
                    labels.set(key, id);
                    result.labels.push({ position: e.posicion, type: e.tipo });
                }
                return id;
            });
            const key = JSON.stringify(items);
            let pattern = patterns.get(key);
            if (pattern === undefined) {
                pattern = result.patterns.length;
                patterns.set(key, pattern);
                result.patterns.push({ items });
            }
            result.contributions.push({ date: s.date, owner: plan.mail, planId: plan.planId, pattern });
        }
    }
    return result;
}
/** The existing pure grouping function remains the oracle, including votes/ties.
 * Current profile names are joined at read time, so renaming a user rewrites no month.
 */
export function queryMonthlyAgenda(agenda: MonthlyAgenda, date: string, today: string, names: ReadonlyMap<string, string>): TrainingDay {
    if (!validDate(today) || date && !validDate(date))
        throw Error('DATE_INVALID');
    if (agenda.format !== 'pgt-trainer-month-v2')
        throw Error('AGENDA_FORMAT_INVALID');
    const calendars = agenda.calendars.filter(c => date ? c.start <= date && c.end > date : c.end >= today);
    const relevantDates = [...new Set(calendars.flatMap(c => agenda.dateSets[c.dateSet].dates))].sort();
    const chosen = date || relevantDates.find(d => d > today) || '';
    if (chosen && chosen.slice(0, 7) !== agenda.month)
        throw Error('AGENDA_MONTH_NOT_LOADED');
    const contributions = new Map(agenda.contributions.filter(c => c.date === chosen).map(c => [JSON.stringify([c.owner, c.planId]), c]));
    const dictionary: [
        string,
        string
    ][] = agenda.labels.map(v => [v.position, v.type]);
    const indexes = calendars.map(c => {
        const contribution = contributions.get(JSON.stringify([c.owner, c.planId]));
        const items = contribution ? agenda.patterns[contribution.pattern]?.items : undefined;
        if (contribution && !items)
            throw Error('AGENDA_PATTERN_INVALID');
        const index: StructureIndex = { schemaVersion: 1, sourceSha: 'v2-derived', mail: c.owner, planId: c.planId, blocked: c.blocked, dictionary,
            sessions: agenda.dateSets[c.dateSet].dates.map(d => ({ date: d, items: d === chosen ? items ?? [] : [] })) };
        if (chosen && index.sessions.some(s => s.date === chosen) && !contribution)
            throw Error('AGENDA_CONTRIBUTION_MISSING');
        return { index, name: names.get(c.owner) || c.owner };
    });
    const value = trainingDay(indexes, date, today);
    value.missing = agenda.pending.filter(c => date ? c.start <= date && c.end > date : c.end >= today).length;
    return value;
}
