# Notificaciones de comentarios (16/10/2026)

Campana interna con contador de avisos pendientes por técnica, navegación a Mis técnicas y foco sobre el UUID
correspondiente. Usa el snapshot existente y las versiones de comentario del servidor. IndexedDB v4 almacena huellas y
lectura por propietario/técnica; no copia el texto completo. No modifica documentos de negocio ni añade peticiones.

Recepción y aceptación del snapshot de comentarios son atómicas. La migración conserva owner, técnicas pendientes y
cachés anteriores. Actualizar sobre comentarios ya guardados no crea avisos antiguos; una primera restauración en
instalación nueva muestra los comentarios recibidos. Una sincronización posterior del mismo contenido/versión no vuelve
a notificar. Si el comentario cambia varias veces antes de sincronizar, el aviso representa la última versión recibida,
no un historial del servidor. Cada técnica diferente recibe su aviso propio.

Lectura local persistente, disponible offline, aislada por cuenta. Eliminar/vaciar un comentario o eliminar su técnica
retira el pendiente. Abrir la lista conserva los avisos; pulsar uno marca solo esa versión leída y limpia el filtro de
posiciones, abre Mis técnicas y desplaza/enfoca su fila. Escape, cierre y clic exterior cierran la lista. Badge con
número y nombre accesible, foco visible, texto seguro React y panel adaptado a móvil.

Pruebas: unitarias de migración y conservación de pendientes, avisos múltiples, deduplicación, lectura persistente,
versiones, eliminación, aislamiento y rollback. Chromium local con Worker fixture: guardado real de comentarios por
entrenador, sincronización del alumno, recarga, offline, navegación desde otra pestaña con filtro activo, foco, contador
individual, edición, eliminación, cambio de cuenta, teclado y anchura 390 px/escritorio. Capturas internas en
.browser-artifacts/notifications. No son pruebas de cuentas reales ni aceptación Safari/iOS.

Validación local completada: 113 pruebas unitarias, typecheck, build PWA, compilación Worker, tres suites runtime, cinco
suites Chromium y regresión de rendimiento del entrenador. Sin fallos. Capturas revisadas en escritorio y móvil. El
despliegue se comprueba por separado mediante GitHub Actions.
