# Firestore V2 — ejecución del plan, 26/10/2026

## Estado de cierre local

Cliente, API DEV, comandos de negocio, permisos, planes mensuales, proyecciones,
agenda, caché, eventos, recuperación, limpieza y migración privada están conectados
en código. Pruebas y medidas actuales en [VALIDACION_FIRESTORE_V2.md](VALIDACION_FIRESTORE_V2.md).
El propietario ordena terminar sin desplegar: no hay commit/push/PR/merge,
captura de datos reales, importación, activación o despliegue.

Las fases de implementación local no equivalen a operación remota completada.
Los contratos finales, decisiones y límites están en
[FIRESTORE_V2_CONTRATOS.md](FIRESTORE_V2_CONTRATOS.md); el procedimiento operativo en
[MIGRACION_GITHUB_FIRESTORE_V2.md](MIGRACION_GITHUB_FIRESTORE_V2.md).
La secuencia y los objetivos originales siguientes se conservan como origen del
encargo, no como afirmación de que todos los escenarios objetivo estén medidos.

### Inventario de retirada de persistencia GitHub

| Componente | Decisión aplicada |
| --- | --- |
| src/application/client-base.ts | Eliminado |
| src/application/online-client.ts | Eliminado |
| src/application/client.ts | Cliente V2 único, sin selección de persistencia |
| worker/dev.ts | Retirado el montaje anterior; exporta solo runtime V2 |
| bootstrap/flush/recorridos admin del montaje DEV anterior | Retirados de la entrada activa |
| wrangler.dev.jsonc DATA_BRANCH | Eliminado; bindings/migraciones conservados |
| scripts/check-worker.mjs | Compila la entrada DEV V2 |
| package.json test:runtime/test:browser | Gates de la nueva API y cliente reales |
| workflow DEV | Pruebas aisladas V2, sin bootstrap/smoke de Google por push |
| tools/migration/github-source.ts | Única capacidad GitHub nueva: extractor GET-only, fuera del runtime |

No se han borrado los siguientes archivos porque siguen siendo código del destino
PRO protegido o sus oráculos, NO un segundo proveedor de DEV: worker/index.ts,
worker/application.ts, worker/storage.ts, wrangler.jsonc,
.github/workflows/cloudflare.yml y sus pruebas sintéticas de reglas de negocio.
El guard de bundles demuestra que no entran en V2. Su retirada física definitiva
corresponde al corte PRO específicamente autorizado; esta entrega no modifica PRO.

Scripts históricos fuera del gate V2: test-runtime, test-app-runtime,
test-plan-recovery-runtime, test-browser, test-trainer-cache, test-qa-recovery,
test-trainer-reports, test-notifications, test-own-training-day,
test-repertoire-cards y los runners del modelo estructurado anterior.
No ejecutarlos contra la API V2 ni contra Google para intentar validar esta entrega.
No se presentan sus aserciones de navegador como portadas una a una al protocolo nuevo.
Se conservan temporalmente por los oráculos/PRO y los antecedentes de validación.
No hay adaptador de compatibilidad GitHub accesible desde frontend o backend DEV.

### Decisiones frente al plan inicial

- Caché: 32 MiB divididos entre fuentes y vistas, más 16 MiB de bloques inmutables.
  Se evita que planes grandes expulsen autorización/versiones. Se descarta el mapa
  ilimitado de recibos del transporte V2 después de cada commit.
- Estructuras: se ejecuta el dominio original sobre el plan compacto completo;
  se reutilizan los hashes de meses intactos. No se introduce otro algoritmo parcial
  de continuidad. No afirmar que una mutación estructural no lee ningún mes pasado.
- Publicación: commit CAS acotado y sin visibilidad parcial. Los límites explícitos
  están en contratos; no se ha implementado publicación ilimitada por generaciones.
- Consumo: el nuevo banco mide comandos/consultas de 10/30/100 usuarios, HTTP y bytes.
  El objetivo diario completo de la sección original no se declara probado.
- Migración: runner privado con ledger compartido y gate de mantenimiento, sin API
  pública ni activación implícita. Su conexión operativa real exige cuota y storage
  durable reales; no se simula autorización mediante un payload de AppApi.

## Autoridad y alcance
El propietario ordenó ejecutar el plan integral y usar la rama actual, cuyo nombre Git es
`fetaure/optimizacionFirestore`. Esta es la excepción expresa al procedimiento de crear
una nueva feature desde main. Main de referencia: 3b8125cb362f665f908e4028d54514f65f00459a.
HEAD inicial: 9b5573e95197c45d447ca298b70b00994b9f1ecd, sin cambios locales.

El encargo sustituye la convivencia de persistencias y permite caché de negocio volátil
en memoria; SQLite permanece exclusivamente para sesiones, límites y coordinación.
No concede acceso operativo PRO. No modificar GitHub de datos, su visibilidad,
Worker PRO, secretos o datos reales. No desplegar ni ejecutar Google QA con cuota desconocida.

## Fuente de migración
La fuente es exclusivamente `dmda92/pgt-bjj-data`, privado, `PGT/`, fijada a un commit.
No migrar desde Firestore DEV ni mezclar sus datos. Extractor de solo lectura,
conversor offline e importador con staging/activación separados. La producción GitHub
continúa funcionando durante la copia DEV. Conservar el importador fuera del runtime:
el futuro corte PRO usa una captura nueva de GitHub, nunca datos modificados en DEV.
No copiar sesiones ni secretos. DEV usa credenciales independientes; hashes PRO
solo se conservan en el corte PRO específicamente autorizado.

## Arquitectura acordada
Firestore único; cliente online único; comandos con operationId/baseRevision y ACK;
consultas sin efectos de escritura; caché IndexedDB por actor y versión; caché central
LRU de 32 MiB válida por publicaciones, no TTL. WebSocket hibernable con eventos selectivos,
sin polling ni perfiles de todos los sockets por GET. Distribución mensual persistida,
valores deduplicados y vigencias por plan/UUID/fecha. Agenda mensual compartida sin
descripciones ni comentarios. No regenerar planes al leer. Bloques nativos <=512 KiB,
sin strings JSON opacos; límite lógico 4 MiB incluso al materializar.

## Invariantes y oráculos
| Regla | Oráculo/prueba |
| --- | --- |
| UUID exclusivos y orden de arrays | domain.test, fixtures/firestore/domain-baseline |
| Prioridades/pasadas/movimiento -1/+2 | planner, plan-continuity; domain.test |
| Fechas/N/Tábata, descansos históricos cero | domain.test, duration-input, competition-dates |
| Hoy/pasado y torneo finalizado inmutables, Madrid | plan-text-updates, plan-deletions, plan-labels |
| Altas desde cursor; prioridad/orden aislados no recalculan | plan-additions.test |
| Plan vacío prohibido; bloqueo y último válido | plan-recovery.test |
| Autor y versiones server-owned | app-api, plan-text-api |
| Desasignar borra plan entero; reasignar crea | app-api.test |
| Calendario propio sin deduplicar torneos | own-training-day.test |
| Multiconjunto/votos/desempates exactos | trainer-reports.test |
| Cobertura con repertorio actual | coverage, trainer-reports |
| CAS, pendientes, pérdida ACK | structured-model, online-draft |
| PDF literal/Barlow/paginación/offline | pdf.test, pruebas navegador |
| Notificaciones aisladas por dispositivo | local, test-notifications |
| Sin elevación ni acceso cruzado | app-api, runtime |
| Límites lógicos y físicos | json-limits, plan-codec |

No cambiar los cuatro módulos originales protegidos ni regenerar sus resultados.
El commit inicial reformateó los módulos; el guard se mantiene comprobando el hash
de las fuentes originales capturadas en main y equivalencia de compilación sin formato
con las fuentes actuales. Los fixtures esperados originales permanecen intactos.

## Secuencia y puertas
0. Contratos, baseline y medición completa.
1. Codec nativo lossless, bloques/diccionarios y vigencias, límites y roundtrip.
2. Cliente único/commands/CAS/ACK y borradores.
3. Coordinación, seguridad/revocación y caché coherente.
4. Fuentes y propagación selectiva.
5. Continuidad/agenda/cobertura.
6. Tiempo real/IndexedDB/offline.
7. Extractor GitHub read-only/conversor/importador.
8. Retirada de GitHub runtime después de portar sus reglas/pruebas.
9. Todas las validaciones aisladas y banco de consumo.
10. Importación DEV solo después de inventario, autorización operativa y presupuesto fiable.
11. Limpieza por lista exacta, backup y autorización.
12. Corte PRO posterior y específicamente autorizado.

Una fase construida no equivale a una migración, activación ni aceptación remota.
No eliminar componentes previos antes de que su sustituto integrado preserve sus reglas.

## Coste de referencia y objetivos
Transporte sintético actual: agenda 182 sesiones: 10 alumnos 1878 R/68 HTTP,
30 alumnos 5618 R/188 HTTP, 100 alumnos 18708 R/608 HTTP. Plan completo 184 R.
Una descripción: 229 R/27 W con un plan; 599 R/75 W con tres, sin refresco del cliente.

Objetivos representativos: agenda fría <=4 R con 10/30 y <=6 con 100; caliente 0 R.
Texto pequeño <=3+A lecturas y <=4+A escrituras, sin leer distribución.
Inactividad/navegación coherente 0 operaciones; evento propio 0 lecturas de confirmación.
Escenario diario: 100 alumnos/3 entrenadores, 182 sesiones, descarga inicial, 200 textos,
10 estructuras, 600 consultas y ocho reconstrucciones: <5000 R y <5000 W.
Son criterios de aceptación por implementar, no ahorros alcanzados.

## Medición y operación
Contar documentos, consultas vacías, reintentos, escrituras/eliminaciones intentadas
y confirmadas, HTTP, bytes y caché. No confundir transporte con facturación de índices.
Nunca imprimir contenido, hashes privados, tokens ni rutas privadas en informes.
Validar consumo Cloudflare/SQLite/CPU además de Firestore. No usar servicios de pago.

## Seguimiento
Véase VALIDACION_FIRESTORE_V2.md para estado real de pruebas y fases.
Contratos y límites de los componentes conectados localmente, con pasos siguientes:
[FIRESTORE_V2_CONTRATOS.md](FIRESTORE_V2_CONTRATOS.md).
