# Validación del rediseño de referencia y cobertura — 14/10/2026

El propietario rechazó verde/dorado del logo y pidió seguir las capturas de referencia, conservando funciones y datos, con consulta de cobertura solo para entrenadores. Aplicado: navegación pizarra, fondo claro, acentos azules, tipografía Barlow local, repertorio en columnas, sesiones en columnas, iconos PWA coordinados y tres áreas de entrenador (Equipo, Competiciones, Cobertura por fecha). Skill original y licencia permanecen intactas; dirección actualizada en DISENO_FRONTEND.md y AGENTS.md.

## Comprobaciones realizadas

- 51/51 pruebas automatizadas correctas, sin omitidas: incluye cuatro nuevas pruebas de cobertura (límites de fecha, conteo de identidades y repeticiones, primeras fechas, posiciones partidas, pasadas completas/parciales, marcadores adelantados por edición manual, plan vacío y ausencia de mutación).
- TypeScript y build correctos. Bundle del Worker compilado con esbuild local.
- Runtime local workerd + Durable Objects SQLite correcto: registro, hash, login, roles, bootstrap, comentarios, competición, snapshots estables, edición, SHA, desasignación, borrado y revocación. GitHub interceptado, sin datos reales.
- Chromium local con Playwright correcto: flujos previos de registro/login, IndexedDB, recarga offline, pendientes, conflictos entre dispositivos, restauración, cambios de usuario, comentarios, competición, plan, edición manual, PDF offline, contraseña y pestañas antiguas.
- Nuevas comprobaciones de navegador: secciones Equipo/Competiciones/Cobertura; alumno sin plan aún generado; generación mediante primer login/sync del alumno, sin generar desde una lectura del entrenador; selección de alumno/plan; incluir/excluir fecha; apartado ausente para alumnos.
- Equipo y cobertura sin desbordamiento horizontal a 360, 390, 768, 1280 y 1440 px. Movimiento reducido conserva transiciones desactivadas. Capturas locales revisadas en escritorio y móvil, sin publicación de imágenes de QA.

## Alcance de cobertura

Métricas sobre la instantánea guardada de cada plan individual. El universo son técnicas presentes en sus sesiones; los modelos existentes no guardan el catálogo original completo y no se inventa ese denominador. Se explica en pantalla. No registra asistencia. Las pasadas completas requieren sus técnicas programadas y la marca de finalización; las parciales se muestran incluso tras completar una pasada anterior. No se regeneran planes ni se consulta la plantilla actual para reinterpretarlos.

No se modificaron Worker, autenticación, permisos de API, generador, sincronización, IndexedDB, modelos guardados ni exportador PDF. Se añadió un cálculo puro de lectura y se utiliza el endpoint de snapshot existente, autorizado por rol. El informe funcional histórico VALIDACION.md y el informe visual anterior VALIDACION_DISENO.md se conservan.

## Pendiente

Aceptación visual por el propietario tras desplegar; comprobación en sus tres teléfonos físicos y Safari/iOS cuando haya un dispositivo disponible. La emulación no equivale a pruebas físicas. Sin acceso ni despliegue en Cloudflare desde Work.
