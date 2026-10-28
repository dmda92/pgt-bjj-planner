# Configuración manual Cloudflare PRO

Nada de esta guía se ha aplicado a recursos activos. Preparar y revisar los valores no equivale
a autorizar su publicación. Worker actual `pgt-github-probe` sigue funcionando con GitHub.

## En el momento del despliegue autorizado, no antes

| Nombre | Clase | Valor/formato |
|---|---|---|
| FIRESTORE_ENVIRONMENT | Variable servidor | `pro` |
| FIRESTORE_PROJECT_ID | Variable servidor | `pgt-bjj-pro` |
| FIRESTORE_DATABASE_ID | Variable servidor | `(default)` |
| FIRESTORE_SERVICE_ACCOUNT_EMAIL | Variable servidor | `pgt-worker-pro@pgt-bjj-pro.iam.gserviceaccount.com` |
| FIRESTORE_SERVICE_ACCOUNT_JSON | Secreto Worker | JSON completo de esa identidad PRO, nunca el de DEV |
| ALLOWED_ORIGINS | Variable servidor | `https://pgt-github-probe.david-dzm5.workers.dev`; añadir solo otros orígenes reales expresamente revisados |
| WORKER_BUILD_SHA | Variable servidor | SHA de código de 40 hex del despliegue; workflow lo inyecta |

Las variables públicas no son `VITE_*`. El frontend usa su mismo origen y el cliente Firestore
único. No incluir cuentas de servicio en build/bundle. El runtime admite `DEV_BUILD_SHA` como
compatibilidad DEV; PRO utiliza `WORKER_BUILD_SHA` y expone `/api/runtime` de diagnóstico sin datos.
No cambiar las variables habituales de DEV durante la preparación PRO.
Revisar también `ALLOWED_ORIGIN` heredado: el parser admite ese alias y `--keep-vars` puede
conservarlo. No dejar orígenes antiguos no autorizados por accidente; cualquier retirada activa
se hará únicamente durante la configuración autorizada del release.

`FIRESTORE_SERVICE_ACCOUNT_JSON` puede prepararse por canal privado, pero su alta activa en
Cloudflare requiere autorización. Conservar GITHUB_DATA_TOKEN, PROBE_ADMIN_KEY y secretos
anteriores hasta verificar la versión nueva; el bundle nuevo no los usa. No convertirlos en
credenciales Firestore ni quitarlos como parte de una limpieza automática.

## Durable Objects

Conservar `github-probe-v1 / ProbeSecurity` y sus datos. No renombrar ni borrar ese namespace.
La entrada PRO nueva exporta una clase ProbeSecurity inerte (fetch 410, alarm sin trabajo), sin
importar código GitHub. `LEGACY_SECURITY → ProbeSecurity` conserva el binding explícitamente.

La migración **aditiva** `firestore-pro-v2` crea clases SQLite `FirestoreSecurity` y `DomainIO`:
`SECURITY → FirestoreSecurity`, `DOMAIN_IO → DomainIO`. Son nuevas y separadas del namespace
legado, de DEV y del validador. No se reutilizan sesiones GitHub: los usuarios deben iniciar sesión
de nuevo, conservando sus contraseñas migradas. No se modifica el contenido del DO antiguo.

Comprobar la historia real de migraciones/bindings en Cloudflare antes de publicar: esta guía
parte de los archivos Git; no acredita que la cuenta remota coincida. No reemplazar una historia
distinta sin auditarla. Se conserva el formato `migrations` existente; no se cambia a `exports`.
Referencia: [migraciones Durable Objects](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/).

## Actions y autorización de publicación

El workflow preparado sigue validando PR a main. Solo publica desde main, con comprobación
de HEAD, serialización y dos variables de Actions: `CLOUDFLARE_DEPLOY_ENABLED=true` y
`FIRESTORE_PRO_READY=true`. Mantener la segunda ausente/false hasta disponer de migración
activada y verificada, validación del propietario y autorización específica de publicación.
El gate adicional no sustituye la autorización humana. Ningún job ejecuta el migrador.

Mantener `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID` de la cuenta PRO, con permisos
para ese Worker/Static Assets y migración DO. No reutilizar la credencial DEV sin revisar alcance.
Antes de merge, comprobar protecciones, Environment y ausencia de otro publicador (Workers
Builds, otro workflow o despliegue manual). No se han inspeccionado ni cambiado esos secretos
o interruptores remotos durante esta tarea. La PR develop → main y su merge esperan autorización.

## Validador temporal

Ver [PRO_VALIDATION](PRO_VALIDATION.md): Worker independiente
`pgt-firestore-pro-validation`, cuenta PRO viewer, Access verificado criptográficamente y
origen exacto. Sin Durable Objects ni assets/PWA normales. `workers_dev=false` por defecto
impide una URL pública accidental. La ruta/dominio y política Access deben prepararse y autorizarse
antes de desplegarlo. No existe todavía una URL desplegada que entregar.
