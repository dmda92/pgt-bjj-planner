# Incorporación de técnicas y posiciones a planes futuros — DEV 22/10/2026

Autorización: actualizar requisitos, código y desplegar en desarrollo mediante PR a develop.
Feature/future-plan-additions nace de main 3b8125c y después incorpora develop c383f396 (modelo Firestore validado). No
se modifica main, Worker PRO, datos originales ni usuarios DEV.

## Comportamiento

Solo se recalculan fechas > hoy Europe/Madrid; hoy/pasado y competiciones finalizadas permanecen exactos. Se conservan
fechas, N, Tábata, UUID y alumno. Se reutiliza el generador circular existente y el cursor de la última sesión
protegida. No se reinicia en prioridad1 ni se añaden sesiones para forzar cobertura.

- Técnica añadida después del cursor en una posición incompleta: entra en el resto ordenado de esa pasada.
- Técnica insertada antes del cursor o en posición terminada: siguiente pasada de la posición.
- Posición nueva con técnicas: según su lugar en el array y su prioridad; después del cursor puede entrar en la
  aparición pendiente, antes espera la siguiente.
- Posición vacía: no provoca recálculo. Su primera técnica activa la incorporación.
- Prioridad nueva: se añade al anillo ordenado al terminar la aparición actual; conserva la fase -1/+2.
- Si no hay fechas suficientes, el nuevo contenido queda pendiente naturalmente.
- Cambios aislados de prioridad/reordenación no activan esta extensión. Las altas siguen el orden actual de arrays y
  conservan las prioridades de posiciones existentes en el cursor. No hay migración general de planes.

## Implementación y persistencia

src/domain/plan-additions.ts encapsula la extensión DEV. planner.ts, plan-continuity.ts, plan-text-updates.ts y
models.ts mantienen sus hashes de referencia: el generador original y las bajas no se sustituyen. El backend anterior y
su cliente mantienen el comportamiento previo.

StructuredAppApi calcula additionRevision (entero nativo en user_techniques) únicamente al introducir UUID entrenables,
ignorando revisiones falsificadas del cliente. El plan guarda appliedAdditionRevision como checkpoint nativo. La
referencia deletionCatalog preexistente pasa a representar la primera estructura anterior a una baja/alta para
reproducir planes legados: no contiene textos ni credenciales. Se conserva su formato nativo acotado/fallback existente.
No es una fuente de planificación editable.

Todos los planes activos del alumno se revisan mediante el fan-out y recuperación ya existentes; CAS, versiones y outbox
se conservan. Un resultado idéntico no reescribe planes. Los planes nuevos nacen con el checkpoint vigente. Las
actualizaciones pequeñas publican diferencias de sesiones/continuidad y raíz, manteniendo las instantáneas protegidas.
La misma invalidación en tiempo real actualiza IndexedDB y las pantallas. No se añade polling, listeners ni un barrido
remoto.

Cada cursor se valida contra firmas de sesiones, checksum y ejercicios históricos consumidos. Un plan legado solo se
reconstruye si reproduce exactamente el generador usando la referencia anterior guardada por servidor. Si no, se
conserva y muestra structuralUpdateError; no se inventa continuidad ni se borra información.

## Validación

Pruebas de dominio: técnica al final y antes/después del cursor; posición completada; posición nueva antes/después;
prioridad nueva y secuencia circular explícita; posición vacía y posterior primera técnica; calendario agotado; antes de
primera sesión; hoy/torneo protegido; altas sucesivas y replay; legado válido/corrupto; sustitución combinada con bajas
y nueva prioridad.

Runtime workerd/SQLite y protocolo Firestore interceptado: alta técnica, posición vacía sin modificación de planes,
primera técnica en posición nueva, comparación de sesiones futuras con generador original cuando no hay histórico,
protección de sesiones existentes, aviso WebSocket, revisión del cliente ignorada y actualización idéntica sin
escrituras. Un escenario separado mantiene toda la batería de bajas, permisos, CAS, comentarios e histórico.

Chromium aislado: botones Añadir técnica/Añadir posición en la interfaz; plan futuro recibido en IndexedDB
automáticamente, posición vacía sin recálculo y primera técnica incorporada; histórico idéntico. Conserva pruebas de
PDF, aislamiento, fallos de red y tiempo real. El CI ejecuta estos escenarios antes de publicar DEV.

Se detectó además un fixture del runtime heredado con torneo fijo 23/10/2026 que ya no tenía sesiones futuras el 22/10.
Se usan fechas relativas a Madrid (-9/+21 días), conservando los mismos días de semana y comprobaciones: corrección del
test, sin alterar comportamiento de aplicación.

No se ejecutan pruebas ni limpieza contra Google en este cambio. La cuota real sigue sin evidencia fiable. CI usa
exclusivamente transporte interceptado. Publicación por develop con verificación posterior del SHA del Worker y
coordinador.
