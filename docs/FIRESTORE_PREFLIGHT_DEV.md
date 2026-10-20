# Verificación de infraestructura Firestore DEV

Prerrequisito de la migración de PR #6. No sustituye todavía la persistencia GitHub ni migra datos.

## Aislamiento

- Entrada DEV exclusiva `worker/dev.ts`; PRO conserva `worker/index.ts` sin cambios.
- Mismo nombre local de clase ProbeSecurity, binding SECURITY y migración SQLite DEV; la subclase conserva los handlers actuales.
- Proyecto fijo `pgt-bjj-dev`, base fija `(default)` e identidad `pgt-worker-dev@pgt-bjj-dev.iam.gserviceaccount.com`. Se rechaza cualquier configuración/JSON ajeno antes de red. La cuenta informada por el propietario debe coincidir con este identificador.
- Secreto JSON ya instalado en el Worker: no se descarga, copia al repositorio ni añade a GitHub. OAuth RS256/WebCrypto, token temporal solo en memoria, hosts fijos y sin redirects.
- La aplicación conserva la persistencia anterior durante esta comprobación. Solo se escribe una ruta sintética aleatoria bajo `_pgt_dev_diagnostics` en Firestore DEV.

## Autenticación del diagnóstico

`POST /api/dev/firestore-preflight` requiere Origin DEV exacto y credencial de despliegue de Cloudflare. El Worker comprueba esa credencial leyendo settings del nombre fijo de Worker en la cuenta DEV fijada en el despliegue, no en una cuenta indicada por el cliente. Una credencial con ese permiso ya permite administrar el código de ese Worker. No se almacena ni devuelve ni se envía a Google. Sin credencial 401; cuenta/token incorrecto 403; GET 405. No ofrece operaciones genéricas, parámetros de ruta ni acceso a perfiles/datos de negocio.

El workflow DEV utiliza su secreto existente de despliegue y fija DEV_ACCOUNT_ID durante `wrangler deploy`; no añade credenciales. Después llama a la comprobación, registra únicamente el informe público y falla el job si la prueba no confirma conexión. Los logs nunca incluyen respuestas OAuth ni contenido de claves. El wrapper conserva el manejo seguro de errores y Cache-Control no-store.

## Prueba real prevista

1. OAuth con la identidad DEV, sin fallback a GitHub ni PRO.
2. `projects.databases.get`: nombre `(default)`, ubicación devuelta por Google, edición STANDARD y modo FIRESTORE_NATIVE; rechazo de valores distintos.
3. Crear documento temporal con precondición exists=false; leer contenido; actualizar con updateTime; rechazar updateTime obsoleto (409/412).
4. Rechazo de lectura y escritura anónimas sobre ese documento existente.
5. En finally, releer y eliminar solo el documento con marcador aleatorio propio, usando CAS; verificar 404 final. También limpiar creación de resultado incierto si el commit se confirmó pero se perdió su respuesta.

La prueba anónima verifica ese recurso, **no demuestra las reglas completas de toda la base**. Cloud Datastore User no concede permiso para descargar el código de Firebase Rules. El informe declara `rulesSource: NOT_READ_SERVICE_ACCOUNT_HAS_DATA_ROLE_ONLY` para evitar afirmar lo contrario. Confirmar el código exacto de reglas desde consola/plugin con identidad del propietario antes de la fase operativa. No ampliar el rol de runtime a administrador para leer reglas. Spark se mantiene según confirmación del propietario; este runtime no tiene permisos de facturación ni los solicita.

## Validación previa

En feature/firestore-realtime-dev: 140/140 unit tests (131 previos +9 nuevos), typecheck, build, verificador de configuración DEV, dry-run Wrangler y runtime específico DEV pasan. La prueba workerd ejecuta el entrypoint DEV real, la subclase SQLite, JWT firmado verificable, rechazo de credenciales/origen/método y flujo CRUD/CAS/limpieza con transporte interceptado. No equivale a integración remota.

La PR pequeña de infraestructura nace de main y solo contiene estos archivos de diagnóstico/configuración/CI. Su base contiene 117 unit tests previos; con los 9 nuevos debe pasar 126. PR #6 conserva sus fixtures y la implementación posterior. Se integra la infraestructura en develop únicamente después de CI completo. Ni main, workflow PRO, configuración PRO, dominio ni datos reales cambian.

Estado: pendiente de informe real del pipeline DEV. Si metadata es 403 o falta el secreto, el deploy puede publicar el wrapper pero el job debe quedar rojo con código seguro; no declarar terminado el gate ni proseguir como si la conexión existiera.

## Primer ensayo remoto y corrección del diagnóstico

PR #7 integrada en develop `7c408c4`; CI de PR y validación previa al despliegue correctos. El run [39504802882](https://github.com/dmda92/pgt-bjj-planner/actions/runs/39504802882) publicó solo DEV, versión `b56ee7c6-a20b-4f1f-93f5-d220cad55bf7`. El diagnóstico alcanzó OAuth, metadata STANDARD/Native y create/read/update, pero su clasificación de rechazo CAS quedó en rojo (`FIRESTORE_PREFLIGHT_CAS_NOT_ENFORCED`). No se declara superado el gate. Se ejecutó el finally de limpieza; no hubo datos de negocio ni migración.

La comprobación original suponía HTTP 409/412. El [contrato oficial google.rpc.Code](https://github.com/googleapis/googleapis/blob/master/google/rpc/code.proto) también asigna HTTP 400 a FAILED_PRECONDITION. Se añade aceptación estricta de ese status **solo** si el cuerpo estructurado contiene error.code=400 y error.status=FAILED_PRECONDITION. Un 400 INVALID_ARGUMENT sigue bloqueando el gate. Se añade regresión positiva/negativa y se usa ese contrato en workerd; el informe incluye el HTTP real de la escritura obsoleta para el segundo ensayo. Local: 141/141 en PR #6, de las que 10 son pruebas del diagnóstico; en la rama selectiva son 127/127. Pendiente segundo ensayo remoto.

El segundo ensayo, [39506222147](https://github.com/dmda92/pgt-bjj-planner/actions/runs/39506222147), también publicó DEV (versión `b75dbbf3-4fff-457f-8629-a11a7e5496e3`), con CI completo correcto, y volvió a detenerse en CAS. Se añade diagnóstico autenticado y acotado de HTTP/código/status de Google, booleans de versión cambiada/valor actualizado y metadata de ubicación/edición/modo. Nunca se devuelve error.message, documentos, tokens ni claves. El gate permanece bloqueado hasta observar la respuesta exacta. Prueba workerd adicional verifica la serialización y el filtrado de este informe en un fallo sintético. Comprobación HTTP remota de Work: portada DEV 200 con HTML PGT; POST de diagnóstico sin credencial 401 DEPLOYMENT_AUTH_REQUIRED.

## Conexión remota verificada — 20/10/2026 22:27 UTC

La PR #9 se integró por merge en develop `fbc71dc219ef7f9b6760538bc92012e091bca599`, tras CI completo correcto [39507594114](https://github.com/dmda92/pgt-bjj-planner/actions/runs/39507594114). El pipeline de integración y despliegue [39507963337](https://github.com/dmda92/pgt-bjj-planner/actions/runs/39507963337) terminó **success** en validate y deploy-dev. Worker exclusivo `pgt-github-probe-dev`, versión `53fe3f55-336c-40ce-9549-fcade35aeb1d`; sin cambios de assets ni de configuración PRO.

Respuesta real del Worker, registrada por Actions a las 22:27:53 UTC:

```json
{"status":"FIRESTORE_DEV_CONNECTION_VERIFIED","project":"pgt-bjj-dev","database":"(default)","location":"europe-west1","edition":"STANDARD","mode":"FIRESTORE_NATIVE","principal":"pgt-worker-dev@pgt-bjj-dev.iam.gserviceaccount.com","createReadUpdateDelete":true,"staleWriteRejected":true,"staleWriteStatus":400,"anonymousReadDenied":true,"anonymousWriteDenied":true,"rulesSource":"NOT_READ_SERVICE_ACCOUNT_HAS_DATA_ROLE_ONLY","billing":"SPARK_OWNER_CONFIRMED_NOT_QUERIED"}
```

La prueba obtuvo OAuth2 desde el secreto del Worker, leyó metadatos reales, creó/leyó/actualizó un UUID sintético, comprobó el nuevo updateTime y el valor actualizado, rechazó una escritura con la versión anterior (HTTP 400 FAILED_PRECONDITION), rechazó GET/PATCH anónimos y confirmó HTTP 404 después del borrado condicionado. Solo se utilizó `_pgt_dev_diagnostics/{UUID}`; no se leyó ni migró negocio. El acceso de datos está probado; el nombre del rol IAM y Spark siguen siendo información confirmada por el propietario, no una auditoría de políticas IAM/facturación.

El fallo CAS de los dos despliegues anteriores no se reprodujo con esta revisión, que añade lectura explícita después del update y diagnóstico seguro. Este resultado no demuestra por sí solo la causa del fallo anterior ni sustituye las futuras pruebas reales de concurrencia de la aplicación.

**Pendiente manual para cerrar el gate de seguridad:** el propietario debe abrir Firebase → proyecto `pgt-bjj-dev` → Firestore Database → `(default)` → Rules y proporcionar el texto completo de las reglas actualmente publicadas (sin credenciales), confirmando que no tiene cambios pendientes de publicar. La cuenta runtime tiene rol de datos y no se le elevarán permisos para leer la fuente de reglas. El rechazo anónimo del UUID de prueba no prueba todas las rutas ni permisos de usuarios autenticados. Si las reglas difieren del deny-all documentado, revisar antes de publicar cambios; no tocar PRO.

El backend de negocio Firestore y el canal entre dispositivos siguen pendientes de implementación y QA. No se declara terminada la migración ni probado el tiempo real. La PR #6 conserva el trabajo completo y permanece borrador.

## Gate cerrado por configuración aportada por propietario

El propietario proporcionó en el chat las reglas completas deny-all (`allow read, write: if false` para `/{document=**}`) de Firestore DEV. Se incorporan como referencia en `firestore.dev.rules`. Junto al diagnóstico remoto anterior se cierra la preparación de infraestructura y se continúa implementación de negocio. No se ha vuelto a publicar ni alterado ninguna regla cloud; la procedencia del texto es el propietario, no una lectura administrativa desde la cuenta runtime.
