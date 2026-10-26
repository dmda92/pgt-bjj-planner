import type {TrainingPlan} from './models.ts';

/** Read only: never regenerate sessions or combine separate competition plans. */
export function ownTrainingDay(plans: TrainingPlan[], owner: string, today: string, selectedDate = '') {
    const own = plans.filter(plan => plan.mail === owner);
    let date = selectedDate;
    if (!date) for (const plan of own) {
        if (plan.fecha_torneo < today) continue;
        for (const session of plan.sessions) if (session.date > today && (!date || session.date < date)) date = session.date;
    }
    const sessions = date ? own.flatMap(plan => plan.sessions.flatMap((session, index) => session.date === date ? [{
        plan,
        session,
        index
    }] : [])) : [];
    sessions.sort((a, b) => a.plan.fecha_torneo.localeCompare(b.plan.fecha_torneo) || a.plan.planId.localeCompare(b.plan.planId) || a.index - b.index);
    return {date, sessions};
}
