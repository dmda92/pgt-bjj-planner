import React, { useState } from 'react';
import type { Comments } from './domain/models.ts';

/** A dirty editor owns its original CAS base, even when live props advance. */
export function CommentEditor({ source, version, techniqueId, save, run }: {
    source: Comments; version: string; techniqueId: string;
    save: (data: Comments, base: string) => Promise<void>;
    run: (action: () => Promise<unknown>) => Promise<void>;
}) {
    const [draft, setDraft] = useState<{ source: Comments; base: string; text: string }>();
    const [saving, setSaving] = useState(false);
    const current = source.comments.find(c => c.techniqueId === techniqueId)?.comment || '';
    const conflict = !!draft && draft.base !== version;
    return <form onSubmit={e => {
        e.preventDefault();
        if (!draft || conflict || saving) return;
        const pending = draft;
        setSaving(true);
        void run(async () => {
            try {
                await save({ ...pending.source, comments: [
                    ...pending.source.comments.filter(c => c.techniqueId !== techniqueId),
                    { techniqueId, comment: pending.text }
                ] }, pending.base);
                setDraft(undefined);
            } finally { setSaving(false); }
        });
    }}>
        <label>Comentario<textarea name="comment" value={draft?.text ?? current} disabled={saving}
            onChange={e => {
                const text = e.currentTarget.value;
                setDraft(old => old ? { ...old, text } : { source: structuredClone(source), base: version, text });
            }} /></label>
        {conflict && <p role="alert" className="field-error">Los comentarios han cambiado. Copia tu borrador antes de cargar la versión actual.</p>}
        {conflict && <button type="button" className="secondary" onClick={() => setDraft(undefined)}>Cargar comentarios actuales</button>}
        <button disabled={!draft || conflict || saving}>Guardar comentario remoto</button>
    </form>;
}
