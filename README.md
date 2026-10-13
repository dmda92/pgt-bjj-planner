# PGT — prueba de concepto OneDrive

**Estado: prueba bloqueante preparada; Microsoft real y dispositivos pendientes. La aplicación completa todavía no se ha desarrollado.**

Especificación íntegra: [docs/REQUISITOS_PGT_APP.md](docs/REQUISITOS_PGT_APP.md). Frontend y Worker irán en este mismo repositorio. Esta entrega solo permite validar la arquitectura antes de implementar el dominio, IndexedDB, PWA, planes y PDF. No contiene posiciones inventadas ni una plantilla sustitutiva.

## Pruebas locales

Requiere Node 24 y npm. `npm ci`, `npm test`, `npm run typecheck`, `npm run check:worker` (compilación local sin publicar). Los tests usan Graph simulado, nunca demuestran OAuth real. `npm run dev:poc` inicia el Worker y un Durable Object SQLite local; utiliza `.dev.vars` a partir del ejemplo, nunca versionar ese archivo.

## Configuración y validación real

Seguir [docs/PRUEBA_ONEDRIVE.md](docs/PRUEBA_ONEDRIVE.md). Solo el propietario inicia sesión en Microsoft y despliega Cloudflare. Work no necesita ni debe recibir secretos. No ejecutar `deploy:worker` desde Work.

El prototipo contiene una página de prueba servida por el Worker, sin cookies ni almacenamiento de sesiones en navegador: usa un bearer PGT en memoria con duración de 12 horas. Las sesiones son revocables en el servidor y el logout las elimina. Esto es deliberadamente una prueba, no implementa aún la persistencia de sesión requerida para la aplicación final. Las cuentas de prueba tienen `pocOnly: true`; no utilizarlas como altas completas. No hay bootstrap de entrenador ni registro público: el propietario crea los perfiles de prueba mediante clave administrativa. Se sustituirá por los casos de uso definitivos después de superar la validación.

## Arquitectura del prototipo

Worker → Durable Object SQLite único → Microsoft Graph delegado → `PGT/` en una única cuenta personal. Se serializan operaciones completas para evitar rotaciones concurrentes. Tokens AES-GCM cifrados, estados OAuth PKCE de un solo uso, sesiones opacas guardadas por hash, límites de frecuencia y tamaño, CORS con origen exacto. Contraseñas de prueba PBKDF2-SHA256 con 600.000 iteraciones y sal independiente mediante Web Crypto dentro del Durable Object (su cuota de CPU es distinta del Worker de entrada). El frontend no recibe tokens Graph ni contraseñas cifradas. El API no admite URL/ruta Graph arbitraria.

Solo se almacenan tokens, sesiones, estados OAuth y límites en Durable Objects. Los perfiles y JSON de prueba están en OneDrive. Los cambios existentes requieren If-Match y una revisión consecutiva; una creación usa conflictBehavior=fail. Estos comportamientos deben verificarse contra Graph real, especialmente conflictos/creación; no dar por suficiente el mock.

## Cuotas y coste

Plan gratuito exclusivamente. Workers: 100.000 peticiones/día y 10 ms de CPU por petición de entrada. Durable Objects **SQLite** gratuito: 100.000 peticiones/día, 13.000 GB-s/día de duración, 5 millones de filas leídas/día, 100.000 escritas/día y 5 GB de almacenamiento total. Cada petición puede implicar varias operaciones; no interpretar estas cuotas como número de alumnos. El prototipo no hace consultas periódicas. Al superar cuotas gratuitas fallan operaciones; no activar Paid. Revisar rendimiento de PBKDF2 y CPU/duración con la prueba real. OneDrive personal gratuito normalmente ofrece 5 GB compartidos con el almacenamiento Microsoft de la cuenta; confirmar cuota efectiva con el propietario. Las condiciones pueden cambiar.

Fuentes consultadas: https://developers.cloudflare.com/workers/platform/limits/ ; https://developers.cloudflare.com/durable-objects/platform/pricing/ ; https://developers.cloudflare.com/durable-objects/platform/limits/ ; https://learn.microsoft.com/en-us/graph/api/driveitem-put-content ; https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow .

## Aplicación final (pendiente del gate)

Después de validar: React/TypeScript/Vite, IndexedDB y sincronización; `npm run build` producirá `dist`. **Ese comando aún no existe: esta entrega no es la app final.** Pages será configurado por el propietario con rama main, comando npm run build y salida dist. No conectar Pages a este prototipo como si fuera la aplicación terminada. El Worker se configura y publica separadamente desde el mismo repositorio. No hay ningún despliegue efectuado por Work.

## Recuperación

Si Microsoft revoca acceso, API devuelve MICROSOFT_REAUTH_REQUIRED y el propietario repite consentimiento. No borrar JSON de negocio. La clave de cifrado debe conservarse en un gestor privado: cambiarla hace ilegibles los tokens guardados y requiere reautorizar. El panel `Eliminar autorización local` elimina tokens del prototipo pero no revoca Microsoft; revocar consentimiento desde la cuenta Microsoft. Exportación/restauración de datos de la aplicación completa está pendiente; esta prueba no altera planes ni técnicas.
