import React, {useEffect, useRef, useState} from "react";
import {liveQuery} from "dexie";
import {db, type CommentNotice} from "./infrastructure/local.ts";
import type {Comments, Techniques} from "./domain/models.ts";

export function Notifications({owner, techniques, comments, onOpen, onError}: {
    owner: string;
    techniques?: Techniques;
    comments?: Comments;
    onOpen: (id: string) => void;
    onError: (message: string) => void
}) {
    const [notices, setNotices] = useState<CommentNotice[]>([]), [open, setOpen] = useState(false), [loading, setLoading] = useState(true);
    const root = useRef<HTMLDivElement>(null), bell = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        const subscription = liveQuery(() => db.commentNotices.where("owner").equals(owner).toArray()).subscribe({
            next: rows => {
                setNotices(rows);
                setLoading(false);
            }, error: e => {
                setLoading(false);
                onError(String(e));
            }
        });
        return () => subscription.unsubscribe();
    }, [owner]);
    useEffect(() => {
        if (!open) return;
        const outside = (event: PointerEvent) => {
            if (!root.current?.contains(event.target as Node)) setOpen(false);
        };
        const escape = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setOpen(false);
                bell.current?.focus();
            }
        };
        document.addEventListener("pointerdown", outside);
        document.addEventListener("keydown", escape);
        return () => {
            document.removeEventListener("pointerdown", outside);
            document.removeEventListener("keydown", escape);
        };
    }, [open]);
    const targets = new Map(techniques?.positions.flatMap(p => p.tecnicas.map(t => [t.id, {
        position: p.posicion,
        name: t.tipo
    }] as const)) || []);
    const texts = new Map(comments?.comments.map(c => [c.techniqueId, c.comment]) || []);
    const pending = notices.filter(n => n.unread && targets.has(n.techniqueId) && texts.get(n.techniqueId)?.trim()).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt) || a.techniqueId.localeCompare(b.techniqueId));

    async function show(notice: CommentNotice) {
        try {
            await db.transaction("rw", db.commentNotices, db.meta, async () => {
                if ((await db.meta.get("owner"))?.value !== owner) throw Error("Sesión local incompatible");
                const latest = await db.commentNotices.get([owner, notice.techniqueId]);
                if (latest?.version === notice.version) await db.commentNotices.put({...latest, unread: false});
            });
            setOpen(false);
            onOpen(notice.techniqueId);
        } catch (e) {
            onError(e instanceof Error ? e.message : String(e));
        }
    }

    return <div className="notifications" ref={root}>
        <button type="button" ref={bell} className="notification-bell subtle"
                aria-label={`Notificaciones, ${pending.length} pendientes`} aria-expanded={open}
                aria-controls="notification-panel" onClick={() => setOpen(v => !v)}>
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
                 strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4 M12 2V1"/>
            </svg>
            {pending.length > 0 && <span className="notification-count" aria-hidden="true">{pending.length}</span>}
        </button>
        {open && <section id="notification-panel" className="notification-panel" aria-label="Notificaciones">
            <div className="notification-heading"><h2>Notificaciones</h2>
                <button className="subtle" type="button" aria-label="Cerrar notificaciones" onClick={() => {
                    setOpen(false);
                    bell.current?.focus();
                }}>×
                </button>
            </div>
            {loading ? <p role="status"><span className="loading-spinner" aria-hidden="true"/> Cargando notificaciones…
            </p> : pending.length === 0 ? <p>No tienes notificaciones pendientes.</p> :
                <ul>{pending.map(n => <li key={n.techniqueId}>
                    <button type="button" onClick={() => void show(n)}><strong>Comentario del
                        entrenador</strong><span>{targets.get(n.techniqueId)!.position} · {targets.get(n.techniqueId)!.name}</span><span
                        className="notification-preview">{texts.get(n.techniqueId)}</span></button>
                </li>)}</ul>}
        </section>}
    </div>;
}
