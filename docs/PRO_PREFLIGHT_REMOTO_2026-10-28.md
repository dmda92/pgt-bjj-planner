# Comprobaciones remotas de solo lectura PRO

Fecha: 2026-10-28, 21:09 UTC. Destino exclusivo: `pgt-bjj-pro / (default)`.

Las tres claves locales se validaron sin copiarlas al repositorio ni mostrar secretos.
OAuth y lectura de metadatos correctos para las identidades migration, worker y validator.
Base `FIRESTORE_NATIVE`, edición `STANDARD`, región `europe-west1`.

La identidad de migración obtuvo una lista de colecciones vacía, sin página pendiente.
Esto confirma ausencia de colecciones enumerables; no sustituye una exploración de
posibles subcolecciones huérfanas. El propietario confirma base nueva nunca utilizada.

La API administrativa de campos devolvió 403 para las cuatro colecciones. No se
ampliaron permisos. La captura aportada por el propietario muestra exenciones `*`
para aggregates, plans, blocks y operations, sin índices ascendentes, descendentes
ni de arrays; alcance collection-group deshabilitado por configuración heredada.

## Alcance y límites

- Solo OAuth, GET de metadatos/índices y POST de consulta listCollectionIds.
- Cero escrituras o borrados de documentos, cero despliegues o cambios de configuración.
- No se hicieron pruebas de escritura para comprobar permisos.
- OAuth correcto no demuestra permisos IAM efectivos mínimos: falta revisar los roles
  asignados/heredados, en particular que validator no disponga de escritura.
- No se ha medido consumo facturable ni se interpreta «No hay datos» como contador cero.
- Evidencia local saneada: `.qa/pro-preparation/remote-read-only-preflight.json`.

## Paquete preparado, sin cargar

Origen `dmda92/pgt-bjj-data`, SHA `0a754e2b58a929323946217a3be495944818ce89`.
102 archivos, 18 usuarios, 14 planes; conversión sin bloqueos. Contraseñas y planes
preservados, salvo las tres modificaciones de asignaciones autorizadas por separado.
Checksum `411e0040abe8210d6c00671cf98a3af0dd8fef02988bd200114ed75e37aae4fc`.
Namespace `pgt_v2/import-411e0040abe8210d6c00671c`.

Estimación sintética: 1.005 lecturas lógicas, 260 escrituras, cero borrados.
Reserva conservadora de lecturas: 1.428. Presupuesto propuesto con margen:
1.835 lecturas / 375 escrituras / cero borrados. No es consumo remoto medido.

Ante fallo parcial: detener ejecución, conservar ledger y paquete; verificar y
reanudar el mismo namespace inactivo, nunca recapturar GitHub ni limpiar a ciegas.
Activación CAS solo después de verificar staging; no despliega ni cambia el Worker.
El procedimiento detallado está en PRO_EJECUCION_Y_RECUPERACION.md.

La captura IAM posterior aportada por el propietario muestra roles de proyecto:
`pgt-migration-pro` y `pgt-worker-pro`: Cloud Datastore User;
`pgt-validator-pro`: Cloud Datastore Viewer, sin otro rol visible en esa tabla.
No se auditó una política completa de organización ni posibles concesiones externas.
La cuenta firebase-adminsdk es distinta y no se usa en esta migración ni validador.

Antes de primera escritura: evidencia vigente de disponibilidad de cuota,
concesión presupuestaria y autorización expresa del propietario para este SHA/checksum.
Los cambios de GitHub posteriores al SHA quedan excluidos por decisión del propietario.
