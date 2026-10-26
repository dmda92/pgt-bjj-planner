import type {Techniques, TrainingPlan} from './models.ts';

/** Refresh display labels by stable UUID without rescheduling exercises or
 * touching protected snapshots, continuity, priorities, texts or checkpoints. */
export function updateFuturePlanLabels(plan: TrainingPlan, techniques: Techniques, today: string): TrainingPlan {
    if (plan.fecha_torneo <= today || plan.structuralUpdateError) return plan;
    const positions = new Map(techniques.positions.map(p => [p.id, {
        name: p.posicion,
        techniques: new Map(p.tecnicas.map(t => [t.id, t.tipo]))
    }]));
    let changed = false;
    const sessions = plan.sessions.map(session => {
        if (session.date <= today) return session;
        let sessionChanged = false;
        const exercises = session.exercises.map(exercise => {
            const position = positions.get(exercise.positionId), name = position?.techniques.get(exercise.techniqueId);
            if (name === undefined || exercise.tipo === name && exercise.posicion === position!.name) return exercise;
            changed = sessionChanged = true;
            return {...exercise, tipo: name, posicion: position!.name};
        });
        return sessionChanged ? {...session, exercises} : session;
    });
    return changed ? {...plan, sessions} : plan;
}
