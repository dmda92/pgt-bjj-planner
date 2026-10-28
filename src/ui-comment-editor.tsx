import React, { useEffect, useRef, useState } from 'react';
import type { Comments } from './domain/models.ts';
import {draftJournal} from './application/draft-journal.ts';

type CommentDraft = {source: Comments; base: string; text: string; generation: number};

/** A dirty editor owns its original CAS base, even when live props advance. */
export function CommentEditor({ actor, owner, source, version, techniqueId, save, run }: {
    actor: string; owner: string; source: Comments; version: string; techniqueId: string;
    save: (data: Comments, base: string) => Promise<{ data: Comments; sha: string }>;
    run: (action: () => Promise<unknown>) => Promise<void>;
}) {
    const [draft, setDraft] = useState<CommentDraft>();
    const [saving, setSaving] = useState(false);
    const [online, setOnline] = useState(() => navigator.onLine);
    const [recovering, setRecovering] = useState(true);
    const [localError, setLocalError] = useState('');
    const [persistedGeneration, setPersistedGeneration] = useState<number>();
    const latest = useRef<CommentDraft | undefined>(undefined);
    const generation = useRef(Date.now());
    const resource = 'comment:' + techniqueId;
    const update = (value: CommentDraft | undefined) => {latest.current = value; setDraft(value);};
    const persist = async (value: CommentDraft) => {
        try {
            await draftJournal.put({actor, owner, resource, data: {text: value.text}, base: value.base,
                baseData: value.source, generation: value.generation});
            setPersistedGeneration(old => Math.max(old || 0, value.generation));
            setLocalError('');
        } catch (error) {
            setLocalError('No se pudo conservar el borrador en este dispositivo. Mantén la pantalla abierta y copia el texto antes de salir.');
            throw error;
        }
    };
    useEffect(() => {
        const updateConnection = () => {
            setOnline(navigator.onLine);
            if (navigator.onLine) setLocalError(message => message.startsWith('Sin conexión.') ? '' : message);
        };
        window.addEventListener('online', updateConnection);
        window.addEventListener('offline', updateConnection);
        return () => {
            window.removeEventListener('online', updateConnection);
            window.removeEventListener('offline', updateConnection);
        };
    }, []);
    useEffect(() => {
        let active = true;
        setRecovering(true);
        void draftJournal.get<{text: string}>(actor, owner, resource).then(saved => {
            if (!active || !saved) return;
            if (typeof saved.data?.text !== 'string' || typeof saved.base !== 'string' || !Array.isArray((saved.baseData as Comments)?.comments)) {
                setLocalError('No se pudo recuperar el borrador del comentario. Conserva una copia de los datos locales antes de continuar.');
                return;
            }
            generation.current = Math.max(generation.current, saved.generation);
            if (saved.volatile) {
                setLocalError('No se pudo conservar el borrador en este dispositivo. Mantén la pantalla abierta y copia el texto antes de salir.');
            } else setPersistedGeneration(saved.generation);
            update({text: saved.data.text, base: saved.base, source: saved.baseData as Comments, generation: saved.generation});
        }).catch(() => {
            if (active) setLocalError('No se pudo leer el borrador de este dispositivo. Mantén la pantalla abierta y copia el texto antes de salir.');
        }).finally(() => {if (active) setRecovering(false);});
        return () => {active = false;};
    }, [actor, owner, resource]);
    const current = source.comments.find(c => c.techniqueId === techniqueId)?.comment || '';
    const conflict = !!draft && !saving && draft.base !== version;
    return <form onSubmit={e => {
        e.preventDefault();
        if (!navigator.onLine) {setLocalError('Sin conexión. Los comentarios son de solo lectura hasta recuperar la conexión.'); return;}
        if (!draft || draft.text === current || conflict || saving || recovering) return;
        const pending = draft;
        setSaving(true);
        void run(async () => {
            await persist(pending);
            await draftJournal.checkpoint();
            const saved = await save({ ...pending.source, comments: [
                ...pending.source.comments.filter(c => c.techniqueId !== techniqueId),
                { techniqueId, comment: pending.text }
            ] }, pending.base);
            // Continue typing during the request without losing the new draft.
            // Advance only from this editor's own acknowledged comment revision.
            const next = latest.current;
            if (!next || next.generation === pending.generation) {
                await draftJournal.remove(actor, owner, resource, pending.generation);
                if (!latest.current || latest.current.generation === pending.generation) update(undefined);
            } else {
                const advanced = {...next, source: saved.data, base: saved.sha, generation: ++generation.current};
                update(advanced);
                await persist(advanced);
            }
        }).finally(() => setSaving(false));
    }}>
        <label htmlFor={`trainer-comment-${techniqueId}`}>Comentario</label>
        <textarea id={`trainer-comment-${techniqueId}`} name="comment" value={draft?.text ?? current} readOnly={recovering || !online}
            onChange={e => {
                if (!navigator.onLine) {setLocalError('Sin conexión. Los comentarios son de solo lectura hasta recuperar la conexión.'); return;}
                const text = e.currentTarget.value;
                const next = {...(latest.current || {source: structuredClone(source), base: version}), text, generation: ++generation.current};
                update(next);
                void persist(next).catch(() => {});
            }} />
        {recovering && <p role="status">Recuperando borrador del comentario…</p>}
        {draft && <p className="hint">{!localError && persistedGeneration === draft.generation
            ? 'Borrador de comentario conservado en este dispositivo.'
            : 'Borrador de comentario pendiente de copia local.'} Pulsa Guardar comentario remoto para enviarlo.</p>}
        {localError && <p role="alert" className="field-error">{localError}</p>}
        {conflict && <p role="alert" className="field-error">Los comentarios han cambiado. Copia tu borrador antes de cargar la versión actual.</p>}
        {conflict && <button type="button" className="secondary" onClick={() => {
            const pending = latest.current;
            void run(async () => {
                await draftJournal.remove(actor, owner, resource, pending?.generation);
                if (latest.current?.generation === pending?.generation) update(undefined);
            });
        }}>Cargar comentarios actuales</button>}
        <button disabled={!draft || draft.text === current || conflict || saving || recovering || !online}>Guardar comentario remoto</button>
    </form>;
}
