import React, { useState } from 'react';
import type { Comments } from './domain/models.ts';

/** A dirty editor owns its original CAS base, even when live props advance. */
export function CommentEditor({ source, version, techniqueId, save, run }: {
    source: Comments; version: string; techniqueId: string;
    save: (data: Comments, base: string) => Promise<{ data: Comments; sha: string }>;
    run: (action: () => Promise<unknown>) => Promise<void>;
}) {
    const [draft, setDraft] = useState<{ source: Comments; base: string; text: string }>();
    const [saving, setSaving] = useState(false);
    const current = source.comments.find(c => c.techniqueId === techniqueId)?.comment || '';
    const conflict = !!draft && !saving && draft.base !== version;
    return <form onSubmit={e => {
        e.preventDefault();
        if (!draft || draft.text === current || conflict || saving) return;
        const pending = draft;
        setSaving(true);
        void run(async () => {
            const saved = await save({ ...pending.source, comments: [
                ...pending.source.comments.filter(c => c.techniqueId !== techniqueId),
                { techniqueId, comment: pending.text }
            ] }, pending.base);
            // Continue typing during the request without losing the new draft.
            // Advance only from this editor's own acknowledged comment revision.
            setDraft(latest => !latest || latest.text === pending.text ? undefined : { ...latest, source: saved.data, base: saved.sha });
        }).finally(() => setSaving(false));
    }}>
        <label htmlFor={`trainer-comment-${techniqueId}`}>Comentario</label>
        <textarea id={`trainer-comment-${techniqueId}`} name="comment" value={draft?.text ?? current}
            onChange={e => {
                const text = e.currentTarget.value;
                setDraft(old => old ? { ...old, text } : { source: structuredClone(source), base: version, text });
            }} />
        {conflict && <p role="alert" className="field-error">Los comentarios han cambiado. Copia tu borrador antes de cargar la versión actual.</p>}
        {conflict && <button type="button" className="secondary" onClick={() => setDraft(undefined)}>Cargar comentarios actuales</button>}
        <button disabled={!draft || draft.text === current || conflict || saving}>Guardar comentario remoto</button>
    </form>;
}
