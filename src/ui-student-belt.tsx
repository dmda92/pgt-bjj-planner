import React, { useState } from 'react';
import type { Profile } from './domain/models.ts';

export function StudentBeltEditor({ profile, version, save, run }: {
    profile: Profile; version: string; save: (belt: Profile['cinturon'], base: string) => Promise<void>;
    run: (action: () => Promise<unknown>) => Promise<void>;
}) {
    const [draft, setDraft] = useState<{ belt: Profile['cinturon']; base: string } | null>(null);
    const [saving, setSaving] = useState(false);
    const conflict = !!draft && draft.base !== version;
    return <form className="student-belt-editor" onSubmit={event => {
        event.preventDefault(); if (!draft || saving || conflict || draft.belt === profile.cinturon) return;
        const pending = draft; setSaving(true);
        void run(async () => { await save(pending.belt, pending.base); setDraft(null); }).finally(() => setSaving(false));
    }}>
        <label>Cinturón del alumno<select aria-label="Cinturón del alumno" value={draft?.belt ?? profile.cinturon} disabled={saving}
            onChange={event => {
                const belt = event.currentTarget.value as Profile['cinturon'];
                setDraft(previous => ({ belt, base: previous?.base ?? version }));
            }}>{['Blanco', 'Azul', 'Morado', 'Marrón', 'Negro'].map(belt => <option key={belt}>{belt}</option>)}</select></label>
        {conflict && <p role="alert" className="field-error">El perfil ha cambiado. Revisa el cinturón actual antes de guardar.</p>}
        {conflict && <button type="button" className="secondary" onClick={() => setDraft(null)}>Usar cinturón actual</button>}
        <button disabled={!draft || draft.belt === profile.cinturon || conflict || saving}>{saving ? 'Guardando cinturón…' : 'Guardar cinturón'}</button>
    </form>;
}
