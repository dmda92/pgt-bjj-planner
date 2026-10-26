# Validación Firestore V2 — 26/10/2026

## Estado comprobado

Implementación integrada localmente en fetaure/optimizacionFirestore (nombre Git real).
HEAD inicial 9b5573e95197c45d447ca298b70b00994b9f1ecd; main de referencia
3b8125cb362f665f908e4028d54514f65f00459a. No commit, push, PR, merge o despliegue.
Sin captura GitHub de datos, Google real, migración o activación remota.
El propietario ordena cerrar el código y NO desplegar.

Frontend y worker/dev.ts ya usan V2. Estado anterior de componentes desconectados
sustituido por esta validación. PRO continúa protegido e intacto.

## Pruebas ejecutadas

| Comprobación | Resultado |
| --- | --- |
| npm test | 324/324, cero fallos; última batería completa ~179 s |
| npm run typecheck | Correcto; incluye tools/**/*.ts |
| npm run build | PWA correcta, sin publicación |
| npm run check:worker | Compila worker/dev.ts real |
| npm run test:runtime | Tres suites workerd/SQLite correctas |
| npm run test:browser | PWA real + Worker V2 + Chromium, correcto |
| npm run check:firestore-v2 | Sin proveedor GitHub/migrador/fixtures en bundles |
| node scripts/check-dev-config.mjs | DEV/bindings/origen y guard develop correctos |
| benchmark:firestore-v2 | Componentes y comandos/consultas autorizadas sintéticas |

Después de la batería completa se añadió el descarte del mapa ilimitado de recibos
en memoria del transporte V2. Sus pruebas de batch/immutable cache pasan (3/3);
los checks finales de compilación/runtime se repitieron y pasan para esa modificación.

La regresión de 100 participantes se amplió a un plan de dos años: publicación
atómica, agenda con 100 participantes y consulta del último día correctas.
Es Node/transporte sintético, NO evidencia de CPU/memoria aceptables en Cloudflare
para ese extremo. El runtime integrado cubre planes representativos más pequeños.

Runtime: login/alta, CORS, aislamiento, WebSocket, planes/asignaciones atómicas,
snapshot conocido caliente con cero lecturas, actualización tras ACK sin lectura,
agenda, revocación de rol. La tercera suite inyecta un fallo de entrega y recupera
el evento desde su recibo/SQLite sin repetir la mutación ni mantener polling.

Navegador: dos dispositivos Chromium, texto español en tiempo real, plan completo,
PDF descargable online y offline, recarga PWA offline, foco/inactividad sin lecturas;
dos entrenadores con borrador concurrente, base CAS congelada y conflicto visible,
carga explícita de la versión actual, comentario recibido por alumno.
Se aborta deliberadamente una respuesta HTTP después del commit: el cliente
recupera su ACK mediante el mismo operationId, sin repetir la mutación.
Capturas escritorio/móvil/entrenador inspeccionadas, sin rediseño visual.

Migración: captura GET-only/pinned SHA, integridad/cifrado, conversión sin generación,
staging reanudable/inactivo, presupuesto agotado, verificación independiente,
activación CAS y credenciales DEV, gate de mantenimiento y runner con ledger
compartido. Pruebas con almacenamiento transaccional sintético, nunca Google.

Los cuatro módulos protegidos y los resultados congelados no se modificaron.
El guard valida hashes de fuentes originales y equivalencia de compilación con
el formato actual del propietario. No se regeneran fixtures para acomodar V2.

## Consumo medido localmente

Banco reproducible: scripts/benchmark-v2-application.mjs.
Salida local ignorada por Git: .browser-artifacts/v2-application-cost.json.
Autorización/coordinador/comandos reales, cachés de los mismos tamaños que runtime,
transporte interceptado. Bytes incluyen JSON de request/response Firestore;
excluyen cabeceras, TLS, OAuth y tráfico navegador.

| Operación | 10 usuarios R/W | 30 usuarios R/W | 100 usuarios R/W |
| --- | --- | --- | --- |
| Crear competición de 31 días para todos | 100/67 | 280/187 | 910/607 |
| Primera restauración propia de todos después de crear | 30/0 | 90/0 | 300/0 |
| Diez visitas por usuario con versiones conocidas | 0/0 | 0/0 | 0/0 |
| Primera consulta de día, actor ya autorizado y fuentes calientes | 1/0 | 1/0 | 1/0 |
| Cien consultas posteriores del día | 0/0 | 0/0 | 0/0 |
| Descripción con un plan activo | 4/3 | 4/3 | 4/3 |
| Snapshot propio después de ACK | 0/0 | 0/0 | 0/0 |
| Un handshake de versiones tras reiniciar coordinador | 6/0 | 6/0 | 6/0 |

Creación 10/30/100: 89/249/811 HTTP; texto 4 HTTP; primer día 1 HTTP.
El alta de 100 consume ~15,1 MB de JSON Firestore agregado; restaurar todos ~10 MB.
Texto ~51,8 KB y handshake ~66,6 KB. No confundir HTTP con documentos facturables.
batchGet reduce HTTP y puede aumentar bytes del envoltorio, sin reducir lecturas.

Componente de almacenamiento, plan 182 sesiones/7 meses: 8 R completo, 2 R fecha
base, 3 R fecha con vigencias. Agenda mensual compartida: 1 R en fixture 10/30/100.
Excluye autorización, control de activación, directorio y API fría. Los 2 documentos
de activación se leen al arrancar una instancia y no en cada petición.

Referencia histórica sintética: plan completo 184 R; texto con un plan 229 R/27 W.
Comparación de texto: 4 R/3 W en el núcleo nuevo; ~98,3 % menos R y ~88,9 % menos W
para esa hipótesis, sin incluir refrescos antiguos ni atribuirlo a producción.
Agenda antigua 1878/5618/18708 R incluye más capas que el componente V2 de 1 R:
NO presentar un porcentaje de esa comparación como medida integrada equivalente.

El banco ejecuta 10/30/100 usuarios con un plan corto, no la carga diaria completa
del objetivo inicial (200 textos, 10 estructuras, varios planes, ocho reinicios).
El objetivo <5000 R/<5000 W diario NO se declara demostrado. Evicciones, fuentes
fragmentadas, múltiples planes y reinicios amplios añaden lecturas; tampoco se
garantiza no agotar Spark para cualquier volumen arbitrario.

Facturación verificada con documentación oficial:
lecturas/escrituras de documentos, entradas de índices cuando aplican, mínimo
de consultas vacías y listeners/reconexiones se facturan por sus reglas, no por
HTTP. V2 no utiliza listeners Firestore. Limpieza consume sus propias lecturas
de cabecera/página y deletes; los benchmarks de comandos no incluyen sus alarms.
El recibo de un comando no-op puede costar una escritura para conservar idempotencia.
No se ha medido factura, cuotas reales, index entries, egress o recursos Cloudflare.

## Retirada GitHub y evidencias históricas

Eliminados client-base.ts (825 líneas), online-client.ts (325), montaje DEV anterior
y su bootstrap/flush/smoke; ya no hay GitHub en el recorrido DEV ni dos proveedores.
Los scripts activos validan V2. Retirada/inventario y límites en
[FIRESTORE_V2_IMPLEMENTACION.md](FIRESTORE_V2_IMPLEMENTACION.md).

Se conservan fuentes y tests del runtime PRO fuera de V2. Los scripts antiguos de
browser/protocolo GitHub no se presentan como pruebas V2 ejecutadas ni equivalentes
a la nueva suite. Las reglas de negocio se mantienen también en tests unitarios
y oráculos. No se ha portado cada aserción individual de los siete scripts antiguos
a Chromium V2; no afirmar cobertura numérica o aceptación Safari/iOS.

En la etapa inicial el runtime heredado falló con ECONNRESET en test-runtime.mjs:349
y test-app-runtime.mjs:254; test-plan-recovery-runtime.mjs pasó por separado.
No se atribuye el fallo a una línea base no medida. Estos fallos históricos no se
ocultan como éxitos: la puerta activa ahora compila/prueba la entrada DEV sustituida.

## Cierre y operación pendiente

Diff revisado: algoritmos protegidos, Worker/config/workflow PRO sin cambios.
Cambios por grupos: worker/v2, cliente/cachés/proyecciones, formulario de comentario
y eventos UI, tools/migration, pruebas/scripts, CI DEV, README y documentación V2.
worker/structured/firestore.ts añade solo un método para vaciar recibos; la ruta
anterior conserva su comportamiento. Índices V2 preparados, no publicados.

No hay PR origen/destino creada. La futura revisión será esta feature → develop,
solo con autorización compatible con NO desplegar; un push/merge puede activar
CI/CD, por eso no se ha hecho. No hay recursos externos alterados.

Pendiente operativo: captura/inventario autorizados, cuota fiable, storage durable
real/gate de mantenimiento para runner privado, publicación revisada de índices,
staging/activación y comprobación mínima DEV. Todo eso queda SIN ejecutar.
No ejecutar PRO ni reutilizar credenciales PRO.

## Actualización operativa — migración solicitada 26/10/2026

Sustituye el estado operativo anterior: PR #25 y #26 integradas en develop;
runtime DEV ad32940318be9a517340749bad5076a3bf7aba8c desplegado y endpoint de
versión HTTP 200 verificado. Main y recursos PRO intactos.

Nueva autorización expresa para migrar GitHub PRO a DEV y habilitar uso/pruebas.
Captura bare GET-only cifrada y conversión offline: 102 archivos, 18 usuarios,
3 entrenadores, una competición, 14 planes. Tres índices de asignación obsoletos
se reconstruyen del catálogo como hacía updateIndexes, sin tocar el origen ni
los snapshots. Una asignación sin plan permanece recuperable.

Simulación completa con esta captura, sin HTTP Google: 403 lecturas estimadas,
296 escrituras, cero eliminaciones; límites propuestos con margen 554/420/0.
Pruebas locales: 327/327 npm test; typecheck, build, check:worker y test:runtime
correctos. Nuevas pruebas de fuente bare exacta/read-only, reconstrucción de índices
y ledger SQLite persistente, rollback y reservas entre conexiones concurrentes.
No hay cambios UI. Claves, captura y credenciales generadas solo en ubicación
privada fuera de Git, con ACL Windows restringida al operador.

Clave local validada como identidad pgt-worker-dev/pgt-bjj-dev. Única consulta
remota de esta fase: metadatos administrativos de índices, HTTP 403, sin lecturas
o escrituras de documentos. Se requiere confirmación explícita de las cuatro
exenciones por el propietario; no se amplía IAM. Cuota actual pendiente de aportar.
Importación, activación y login real todavía NO ejecutados. No afirmar que DEV
está lista para uso por tener una simulación correcta o un despliegue de código.

## Corrección posterior de autoguardado — 26/10/2026

La migración se completó después del estado anterior y se comprobó login/plan en
Chromium real; PR #27 integrada y DEV e110f8f publicada. Evidencia operativa privada
fuera del repositorio. El propietario reportó RATE_LIMIT durante edición; diagnóstico,
corrección y pruebas aisladas en [FIX_AUTOGUARDADO_RATE_LIMIT.md](FIX_AUTOGUARDADO_RATE_LIMIT.md).
No se modifican sus datos para reproducir ni verificar esta incidencia.

## Nombres incompletos en edición — 26/10/2026

Reproducción local de PAYLOAD_INVALID al vaciar el nombre durante el autoguardado,
corrección del borrador y 336 pruebas en [FIX_PAYLOAD_INVALID_EDITOR.md](FIX_PAYLOAD_INVALID_EDITOR.md).
La pausa inicial para agrupar cambios ha sido sustituida por autorización de entrega
con Equipo/Competiciones. Validación conjunta y estado operativo en
[CAMBIOS_EQUIPO_2026-10-26.md](CAMBIOS_EQUIPO_2026-10-26.md).
No se han alterado datos DEV para QA ni recursos PRO.

Límites de diseño explícitos en [contratos](FIRESTORE_V2_CONTRATOS.md): commits
acotados, extremo remoto de memoria no medido y lectura compacta completa para
estructuras. No presentar esta implementación como óptimo matemático demostrado.
