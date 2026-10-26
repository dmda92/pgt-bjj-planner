import type { Profile } from '../domain/models.ts';
type NamedProfile = Pick<Profile, 'mail' | 'nombre' | 'apellidos'>;
const spanish = new Intl.Collator('es', { sensitivity: 'base', numeric: true });
export const fullName = (profile: NamedProfile) => [profile.nombre, profile.apellidos].filter(Boolean).join(' ').trim() || profile.mail;
/** Presentation order only. Never reorder domain arrays or mutate fetched data. */
export function sortedUsers<T extends { profile: NamedProfile }>(users: readonly T[]): T[] {
    return [...users].sort((a, b) => spanish.compare(a.profile.nombre || a.profile.apellidos || a.profile.mail, b.profile.nombre || b.profile.apellidos || b.profile.mail) ||
        spanish.compare(a.profile.apellidos, b.profile.apellidos) || spanish.compare(a.profile.mail, b.profile.mail));
}
