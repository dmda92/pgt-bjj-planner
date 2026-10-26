import React from 'react';
import type { Position } from './domain/models.ts';

/** Shared card shell for own repertoire and the trainer's read-only view. */
export function RepertoirePosition({ position: p, open, onToggle, hidden = false, children }: {
    position: Position; open: boolean; onToggle: (open: boolean) => void; hidden?: boolean; children: React.ReactNode;
}) {
    const described = p.tecnicas.filter(t => t.descripcion_del_alumno.trim()).length;
    const complete = p.tecnicas.length > 0 && described === p.tecnicas.length;
    return <details className={`position repertoire-position ${complete ? 'is-complete' : 'is-incomplete'}`}
        data-position-id={p.id} open={open} hidden={hidden} onToggle={event => onToggle(event.currentTarget.open)}>
        <summary className="position-summary">
            <span className="position-summary-heading"><span className="position-name-block"><strong>{p.posicion || 'Sin nombre'}</strong>
                <small className="priority-caption">Prioridad {p.prioridad}</small></span><span className="position-chevron" aria-hidden="true">⌄</span></span>
            <span className="position-summary-meta"><span>{p.tecnicas.length} {p.tecnicas.length === 1 ? 'técnica' : 'técnicas'}</span>
                <span className="position-status">{!p.tecnicas.length ? 'Sin técnicas' : complete ? '✓ Completa' : `${p.tecnicas.length - described} sin descripción`}</span></span>
            <span className="position-progress" role="progressbar" aria-label={`Descripciones de ${p.posicion}`} aria-valuemin={0}
                aria-valuemax={Math.max(1, p.tecnicas.length)} aria-valuenow={described} aria-valuetext={`${described} de ${p.tecnicas.length} técnicas con descripción`}>
                <span style={{ width: `${p.tecnicas.length ? described / p.tecnicas.length * 100 : 0}%` }} /></span>
            <span className="technique-marks" aria-label="Estado de cada técnica">{p.tecnicas.map((technique, index) => <span key={technique.id}
                className={technique.descripcion_del_alumno.trim() ? 'is-described' : 'is-missing'}
                title={`${technique.tipo}: ${technique.descripcion_del_alumno.trim() ? 'con descripción' : 'sin descripción'}`}
                aria-label={`${technique.tipo}: ${technique.descripcion_del_alumno.trim() ? 'con descripción' : 'sin descripción'}`}>
                <span className="technique-mark-name" aria-hidden="true">{index + 1}. {technique.tipo || 'Sin nombre'}</span>
                <span aria-hidden="true">{technique.descripcion_del_alumno.trim() ? '✓' : '○'}</span></span>)}</span>
            <span className="position-open-hint">{open ? 'Cerrar posición' : complete ? 'Ver técnicas' : 'Abrir y completar'}</span>
        </summary>
        {children}
    </details>;
}
