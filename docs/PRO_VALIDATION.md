# Validador temporal de Firestore PRO

Preparación local, NO desplegado. No existe una URL real autorizada todavía.

## Por qué no reutilizar el Worker normal

`worker/v2/runtime.ts` escribe contadores de límites, sesiones, tickets, revocaciones,
outbox, alarmas y coordinación GC en Durable Objects. Login puede registrar sesiones;
registro/comandos/mantenimiento escriben negocio. Ocultar botones no lo evita.
`worker/validation.ts` no importa ese runtime, UserService ni BusinessCommands. Usa
exclusivamente V2ReadApi/QueryCoordinator para consultas, con un actor entrenador ya
existente configurado por servidor y una sesión efímera que nunca se almacena.
No inicia alarmas, WebSockets, reparaciones, proyecciones ni generación. No posee bindings DO
ni secretos de los Workers existentes. Su aislamiento es mayor: no crea DO.

## Controles obligatorios antes de cualquier publicación

1. Primero autorización expresa del propietario para desplegar este Worker separado.
2. Staging activado/verificado, informe profundo aprobado y SHA/namespace definitivos.
3. Crear identidad `pgt-validator-pro@pgt-bjj-pro.iam.gserviceaccount.com`, únicamente
   `roles/datastore.viewer` en `pgt-bjj-pro` (sin Editor/Owner/Datastore User ni roles heredados
   que añadan escritura). Revisar permisos efectivos. Reglas deny-all cliente se conservan.
   El secreto independiente `FIRESTORE_SERVICE_ACCOUNT_JSON` contiene esa clave JSON completa;
   nunca la del runtime ni DEV. IAM garantiza lectura; guard de transporte adicional permite
   solo GET documentos dentro del namespace fijado/control y POST batchGet de esos documentos.
   OAuth token POST se permite al host fijo; commit/PATCH/DELETE/transacciones/runQuery/redirecciones
   no se siguen ni se ejecutan. Ningún comando devuelve hashes de contraseñas al navegador.
4. Configurar dominio personalizado exclusivo y aplicación Cloudflare Access self-hosted
   con política allow únicamente para propietario/revisores explícitos y MFA/IdP apropiado.
   No habilitar bypass ni workers.dev. La firma JWT RS256 se verifica en servidor contra
   JWKS del issuer exacto, además de aud/exp/iat/nbf/email allowlist; headers de email sueltos
   no autorizan. No usar el correo de alumnos como allowlist por defecto.
5. Completar variables (todas servidor, nunca parámetros cliente):

| Nombre | Valor/formato |
|---|---|
| FIRESTORE_ENVIRONMENT | `pro` |
| FIRESTORE_PROJECT_ID | `pgt-bjj-pro` |
| FIRESTORE_DATABASE_ID | `(default)` |
| FIRESTORE_SERVICE_ACCOUNT_EMAIL | `pgt-validator-pro@pgt-bjj-pro.iam.gserviceaccount.com` |
| VALIDATION_ORIGIN | `https://<dominio-exclusivo>` sin barra final |
| VALIDATION_ACCESS_ISSUER | `https://<equipo>.cloudflareaccess.com` |
| VALIDATION_ACCESS_AUD | AUD de Access, 64 caracteres hexadecimales |
| VALIDATION_ALLOWED_EMAILS | correos de revisores permitidos, separados por coma |
| VALIDATION_ACTOR_EMAIL | correo normalizado de entrenador existente en dataset migrado |
| VALIDATION_NAMESPACE | `pgt_v2/import-<checksum24>` verificado/activo |
| VALIDATION_BUNDLE_CHECKSUM | SHA-256 del bundle verificado, 64 hexadecimales; prefijo24 del namespace |
| VALIDATION_SOURCE_COMMIT | commit de origen, 40 hexadecimales |

`wrangler.validation.jsonc` deliberadamente NO contiene valores ficticios de acceso
que puedan habilitar una publicación utilizable accidental. No tiene assets normales,
service worker, almacenamiento local, sesiones persistentes, bindings ni migraciones.

## Procedimiento visual del propietario tras autorización

Entrar en dominio exclusivo protegido por Access. Inspector de solo lectura, diferente
a la interfaz completa editable: muestra datos JSON legibles mediante las mismas consultas
V2. Consultar Usuarios y Competiciones, introducir cada correo para Perfil, Técnicas,
Comentarios, Asignaciones y Planes e histórico. Revisar UUID, textos, participantes,
tombstones, fechas, ejercicios/Tábata y sesiones de fechas anteriores/futuras. Los planes
se materializan en memoria sin generar ni guardar sesiones. Perfiles ocultan pwd y metadatos
privados por la función de dominio existente. Las solicitudes no incluyen contraseñas de usuarios.
No representa una prueba del login normal/password: esa compatibilidad se prueba localmente
con hashes sintéticos y posteriormente mediante humo autorizado del runtime normal.

La verificación estructural exhaustiva debe hacerse con el migrador; visitar todas las
instantáneas en UI puede descargar planes enteros y consumir muchas lecturas. No son pruebas
de carga. Cada solicitud crea coordinador fresco, evitando caché obsoleta tras revocación
Access o cambios externos. Mantener dataset de negocio congelado durante validación; no
existen polls/reconexiones. Registrar consultas y cuota real aparte de estimaciones.

## Comprobaciones locales y límites

`node --experimental-strip-types --test tests/pro-validation.test.ts` usa claves RSA y
transportes sintéticos, nunca Google real: configuración cruzada/incompleta, JWT falsos,
expiración/issuer/aud/allowlist, rutas GET/comandos/login/WS y transporte de solo lectura.
La configuración IAM/Access real, la URL, lectura del dataset y ausencia real de escrituras
siguen pendientes de autorización y preparación manual. No declararlos verificados remotamente.

## Desactivación

Tras autorización, deshabilitar ruta/aplicación de validador y revocar su clave propia.
No borrar bases/DO, no cambiar Workers DEV/PRO ni sus secretos. No incorporar esta identidad
al runtime de negocio. Archivar evidencias sin tokens/JWT/headers y sin hashes privados.

Browser local opt-in: `$env:PGT_VALIDATION_BROWSER="1"; node --experimental-strip-types --test tests/pro-validation.test.ts` (PowerShell). Chromium instalado requerido. Capturas privadas en `.qa/pro-validation-local/inspector-desktop.png` y `inspector-mobile.png`. Todo el transporte se intercepta localmente, JWT y datos son sinteticos; no demuestra configuracion Access/IAM remota.
