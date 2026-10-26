import {db} from '../infrastructure/local.ts';
import type {RemoteRecord, Profile, TrainingPlan, Techniques, Comments} from '../domain/models.ts';
import {validateProfile, validateTechniques, validatePlan, validateVersion} from '../domain/models.ts';

export type TrainerSection = 'techniques' | 'plans' | 'administration';

export interface TrainerView {
    profile: RemoteRecord<Profile>;
    techniques?: RemoteRecord<Techniques>;
    comments?: RemoteRecord<Comments>;
    plans?: RemoteRecord<TrainingPlan>[];
    planSummaries?: { planId: string; fecha_torneo?: string }[];
}

export interface TrainerCacheEntry {
    key: string;
    owner: string;
    mail: string;
    section: TrainerSection;
    data: TrainerView;
    checkedAt: number
}

export const trainerKey = (owner: string, mail: string, section: TrainerSection, planId = "") => JSON.stringify([owner, mail, section, planId]);

export function validateTrainerView(data: TrainerView, mail: string, section: TrainerSection) {
    validateProfile(data.profile?.data);
    if (data.profile.data.mail !== mail || 'pwd' in data.profile.data) throw Error('Ficha remota de otra identidad o con campos privados');
    if (section === 'techniques') {
        validateTechniques(data.techniques?.data);
        validateVersion(data.comments?.data);
        if (!Array.isArray(data.comments?.data.comments)) throw Error('Comentarios no válidos');
    }
    if (section === 'plans') {
        if (!Array.isArray(data.plans) || !Array.isArray(data.planSummaries) || data.planSummaries.some(p => !p || typeof p.planId !== "string" || !(/^[0-9a-f]{8}-[0-9a-f-]{27}$/i).test(p.planId))) throw Error('Planes no válidos');
        for (const p of data.plans) {
            validatePlan(p.data);
            if (p.data.mail !== mail) throw Error('Plan de otro alumno');
        }
    }
}

export const trainerCache = {
    get: (owner: string, mail: string, section: TrainerSection, planId = "") => db.trainerViews.get(trainerKey(owner, mail, section, planId)),
    clear: (owner: string) => db.transaction("rw", db.trainerViews, db.trainerDays, async () => {
        await db.trainerViews.where('owner').equals(owner).delete();
        await db.trainerDays.where('owner').equals(owner).delete();
    }),
};
