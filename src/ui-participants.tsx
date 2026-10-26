import React from 'react';
import type { Profile } from './domain/models.ts';
import { fullName, sortedUsers } from './application/user-presentation.ts';

export function ParticipantChoices({ users, selected, disabled = false, onChange }: {
    users: { profile: Profile }[]; selected?: readonly string[]; disabled?: boolean;
    onChange?: (mail: string, checked: boolean) => void;
}) {
    return <div className="participant-grid">{sortedUsers(users).map(({ profile }) => <label className="participant-choice" key={profile.mail}>
        <input name="student" type="checkbox" value={profile.mail} disabled={disabled}
            {...(selected ? { checked: selected.includes(profile.mail), onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChange?.(profile.mail, event.currentTarget.checked) } : {})} />
        <span><strong>{fullName(profile)}</strong><small>{profile.perfil === 'entrenador' ? 'Entrenador' : 'Alumno'}</small></span>
    </label>)}</div>;
}
