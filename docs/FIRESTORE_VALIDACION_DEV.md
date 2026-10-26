# Evidencias iniciales — migración Firestore DEV

Fecha 20/10/2026; Node 24.19.0. Base main `3b8125cb362f665f908e4028d54514f65f00459a`. Solo datos sintéticos en
memoria/IndexedDB/workerd local. Sin lectura del repo privado de datos y sin credenciales cloud cargadas en el checkout.

## Antes de modificar persistencia

| Comprobación                      | Resultado                                                                                                                                                                       |
|-----------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| npm ci                            | OK, 94 paquetes instalados según lockfile                                                                                                                                       |
| npm test original                 | 117/117 pasan, 0 omitidas                                                                                                                                                       |
| npm run typecheck                 | OK                                                                                                                                                                              |
| npm run build                     | OK, Vite/PWA generados localmente                                                                                                                                               |
| npm run check:worker              | OK, bundle esbuild local                                                                                                                                                        |
| npm run test:runtime              | OK, workerd/SQLite, PBKDF2 nativo/fallback, sesión, aislamiento, comentarios, competición, histórico, CAS, borrado, roles y recuperación de planes                              |
| npm run test:performance          | OK, benchmark sintético con transporte interceptado; no son medidas Firestore ni producción                                                                                     |
| node scripts/check-dev-config.mjs | OK, destino DEV y binding SQLite local                                                                                                                                          |
| npm run test:browser              | Bloqueado localmente: falta Chromium; instalación Playwright intentada y falló al descargar Chrome for Testing 145.0.7632.6, v1208. La cadena no ejecutó sus suites posteriores |

Runtime comprobó recuperación con catálogo vacío y una proyección sintética de 16.842.193 bytes rechazada sin perder las
fuentes. Estas pruebas interceptan GitHub y **no** verifican Firestore remoto.

## Regresiones añadidas

`node --experimental-strip-types --test tests/firestore-domain-regression.test.ts`: 14/14 pasan (12 fixtures completos,
integridad del dominio y secuencia circular). Incluidas en `npm test` por su patrón actual; no se modifica CI para
ejecutarlas.

- Oráculo capturado contra los archivos sin modificar de main, con hashes SHA-256 de planner, plan-continuity,
  plan-text-updates y models.
- Comparación exacta del objeto completo generado/recalculado, no solo totales ni ausencia de excepción. Tiempos,
  cobertura, cursores/checkpoints y entradas originales incluidos.
- Protege hoy/pasado, torneo acabado, continuidad tras borrados, vacío/cursor corrupto, idempotencia, prioridades no
  consecutivas, posición partida, año bisiesto y descansos históricos cero.
- Datos y UUID sintéticos fijos; no datos de alumnos. No se modifican las fuentes de dominio, UI, Worker ni
  configuraciones Wrangler. Único cambio de CI: fijar SO del job de validación DEV para poder ejecutar las pruebas de
  navegador existentes.

Suite completa ampliada ejecutada: **131/131 pruebas pasan**, 0 fallos, 0 omitidas; typecheck posterior OK. El código de
aplicación/bundle no cambia respecto a la línea base anterior. CI remoto de esta PR pendiente al registrar estas
evidencias; consultar el estado del commit en GitHub. No tratar el CI verde del commit anterior como evidencia del
commit nuevo.

CI remoto [39450761182](https://github.com/dmda92/pgt-bjj-planner/actions/runs/39450761182), commit `d7c10f8`: unit
tests 131/131, typecheck, build, compile Worker y runtime OK. Bloqueo adicional de entorno en Install Chromium:
`ubuntu-latest` resolvió a Ubuntu 26.04, que Playwright 1.58.2 rechaza explícitamente. Navegador, benchmark y dry-run
posteriores no se ejecutaron; deploy-dev omitido. Corrección limitada a `validate.runs-on: ubuntu-24.04` en
cloudflare-dev.yml, SO soportado por el registro de plataformas de la versión instalada; sin modificar workflow PRO ni
el job de despliegue. Reejecución CI pendiente tras ese ajuste.

## Gates aún pendientes (no superados)

1. Configuración y verificación de identidad, base, región y facturación DEV.
2. Implementación Firestore; tests de esquema/fragmentación >1 MiB, CAS/transacciones y migrador
   dry-run/idempotencia/integridad.
3. Ausencia de ruta GitHub y de mutaciones offline en la nueva ejecución DEV; persistencia confirmada antes de éxito y
   recuperación ante fallo intermedio/ACK perdido.
4. WebSocket autenticado y revocable, reconexión, duplicados, orden de eventos, cambio de sesión y permisos negativos.
5. Dos contextos de navegador, roles alumno/entrenador, edición técnica→ficha del profesor, comentarios→alumno,
   asignación→entrenamiento del día, borrado, futuro protegido y concurrencia; registrar latencia p50/p95 y contadores
   reales.
6. DEV desplegado tras pruebas y revisión, sin referencias operativas a pgt-bjj-pro ni cambios en main/Worker PRO/datos
   reales.
7. Documentos definitivos de esquema/índices, costes medidos, operación/migración, cutover futuro y rollback; solo
   existe propuesta inicial de arquitectura.

La fase inicial está preparada para revisión; no es una migración terminada. La PR debe permanecer borrador y no
integrarse/desplegarse hasta completar las fases restantes y la configuración manual indicada en
FIRESTORE_CONFIGURACION_DEV.md.

## Actualización de infraestructura — 20/10/2026 22:27 UTC

Las filas y gates anteriores describen la fase inicial. Estado posterior: PR #6 head `019559d` con CI completo
correcto [39507649879](https://github.com/dmda92/pgt-bjj-planner/actions/runs/39507649879): **141 pruebas** (incluye las
14 regresiones congeladas), tipos, frontend, Worker, runtime SQLite, runtime de diagnóstico, navegador/PDF, rendimiento
y dry-run DEV. Los archivos del generador/continuidad/recálculo y los fixtures originales no se han modificado.

Diagnóstico desplegado selectivamente mediante PR #7–#9, todas feature → develop, sin importar develop en las features.
Integración actual develop `fbc71dc`; [39507963337](https://github.com/dmda92/pgt-bjj-planner/actions/runs/39507963337)
terminó success, incluido despliegue y conexión **real** Firestore: proyecto `pgt-bjj-dev`, `(default)`, `europe-west1`,
STANDARD/FIRESTORE_NATIVE; OAuth2 de la cuenta DEV; CRUD sintético, CAS obsoleto rechazado HTTP 400, acceso anónimo
GET/PATCH rechazado y borrado confirmado 404. Evidencia completa y límites
en [FIRESTORE_PREFLIGHT_DEV.md](FIRESTORE_PREFLIGHT_DEV.md).

El gate 1 queda parcialmente resuelto: conexión/metadatos/operaciones verificadas; Spark/rol IAM confirmados por el
propietario. Falta revisar las reglas completas publicadas, que el rol de datos no puede leer. Los gates 2–7 de
implementación, fragmentación/transacciones, migrador, caché, canal y dos clientes siguen pendientes. El despliegue
actual es del diagnóstico y la aplicación anterior; no afirmar que Firestore ya sea la fuente de verdad de negocio.

main permanece `3b8125c`; no hay cambios del Worker/configuración/workflow PRO, ni lectura/copia/migración de datos
reales. Solo documentos sintéticos de diagnóstico en DEV.

## Implementación posterior al texto de reglas aportado por propietario

Gate de infraestructura completado. Se mantiene AppApi y todo el dominio sin cambios, con adaptador físico Firestore
DEV; publicación CAS de entidad/fragmentos/outbox en un Commit, recuperación de ACK y revisiones opacas compatibles con
el contrato. Cliente DEV online separado, caché local, borrador volátil con reintento explícito, canal autenticado y
refresco automático de vistas. Arquitectura/limitaciones en FIRESTORE_OPERACION_DEV.md; cutover futuro solo documental.

Verificación local inicial: 150 unitarias correctas, incluidos oráculos congelados, tamaño >1MiB, UTF-8, CAS
concurrente, ACK perdido, migrador dry-run sin red y roundtrip idempotente, no reenvío de borrador fallido. Typecheck
correcto. Runtime PRO previo se mantiene correcto, con transporte GitHub interceptado; nuevo runtime DEV usa
workerd/SQLite/Firestore simulado y sockets TCP reales: generación completa idéntica, actualización de textos y
recálculo por borrado idénticos, pasado/hoy protegido, aislamiento de tercer alumno, CAS, desasignación y ticket de un
uso. Pruebas de navegador online y remoto pendientes de CI al registrar esta actualización. No declarar tiempo real
remoto hasta obtener el informe con Google real.

## Cierre de ensayo preparado — 21/10/2026 (Madrid)

Reanudación desde `9ce9643`: CI remoto 39513497972 completado correctamente en sus dos jobs de validación; todavía sin
despliegue del backend de negocio. Se añade limpieza administrativa limitada al UUID provisionado por el propio ensayo,
con rechazo de planes compartidos con identidades ajenas, preservación de usuarios no relacionados, tombstones CAS y
revocación de sesiones sintéticas. Los listados se ordenan por nombre lógico para conservar el contrato del proveedor
anterior. El job deploy-dev se fija también a Ubuntu 24.04, pues ahora instala el mismo Chromium que los jobs de
validación.

Validación local de estos cambios: **154/154 pruebas** correctas, typecheck, build de referencia, compilación Worker,
tres suites runtime anteriores, runtime Firestore de aplicación/SQLite/sockets y comprobación de configuración DEV. El
transporte local sigue interceptado; no acredita Google remoto. Generador, recálculo y fixtures congelados intactos.
Pendientes: CI de esta revisión, integración de PR #6 y ensayo real postdeploy con informe de latencia y limpieza. No
hay operaciones sobre main, PRO ni datos reales.

## Primer ensayo real del backend — 21/10/2026 (Madrid)

PR #6 integrada en develop `6ceaa036`. Actions 39515634978 superó validate y validate-online; desplegó únicamente
pgt-github-probe-dev versión ff6e8a4b-b5cc-4d65-b8f3-940775eda126. El preflight Google real pasó de nuevo
CRUD/CAS/anonimato y confirmó europe-west1 STANDARD/FIRESTORE_NATIVE. El ensayo de negocio falló con HTTP 503
FIRESTORE_NETWORK_RETRY al solicitar el snapshot tras crear competición, con 122 peticiones cliente y sin excepciones JS
de página. No se declara QA completa ni se conoce aún la causa exacta del fallo de transporte. La limpieza sintética
terminó sin error; no se generó informe de aceptación.

Corrección de transporte: consumir cada cuerpo de respuesta antes de avanzar (también ACK y 404), reintentar una sola
vez lecturas idempotentes ante error de red o HTTP 502/503/504, nunca repetir Commit; conservar recuperación de ACK por
revisión. Distinguir timeout, límite de subpeticiones y contexto inválido mediante códigos permitidos sin registrar
mensajes de excepción ni secretos. Runtime verifica presupuesto <=50 subpeticiones por llamada del escenario. Se añaden
muestras y checks parciales al informe de fallo para diagnosticar un eventual nuevo fallo remoto. 155 unitarias y
runtime DEV correctos; repetición remota pendiente. main sigue 3b8125c.

## Segundo ensayo real y corrección de coordinación

Actions 39516955122 (`develop 5248662`) volvió a pasar ambos jobs de validación y preflight Google, desplegando DEV
a9449e95-f861-4df9-83d9-d7b83066271e. Confirmó 12 ediciones UI → entrenador sin recarga (3351–4073 ms), exportación y
reintento explícito del borrador, permisos negativos y plan completo idéntico. Falló al actualizar automáticamente
Entrenamiento del día; la captura del entrenador muestra FIRESTORE_SUBREQUEST_LIMIT. Las medidas no cumplen aún el
objetivo inicial de 2 segundos. Limpieza sintética sin error; QA de negocio continúa pendiente.

Se sustituye la cadena compartida de promesas por la exclusión de eventos del DO y se reutilizan lecturas solo dentro de
una operación; las comprobaciones CAS y recuperación de ACK fuerzan una lectura fresca. Las consultas de manifiestos
alimentan esa reutilización efímera. No se almacena negocio entre eventos ni en SQLite. La invalidación distingue, sin
enviar identidades, si afecta a los datos propios; el entrenador puede refrescar la vista de otro alumno sin releer
innecesariamente sus propios planes. Un handshake/aviso propio no se pierde al coalescer eventos posteriores. 156
unitarias y runtime local correcto; no declarar resuelto el límite hasta repetir el ensayo Google real.
