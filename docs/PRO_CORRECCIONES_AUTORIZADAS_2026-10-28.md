# Correcciones de asignaciones autorizadas — 28/10/2026

El propietario autorizó expresamente dos operaciones sobre la conversión para Firestore:
desasignar al participante que carece de plan y reconstruir el índice del participante cuyo
plan sí existe. No autorizó cambios en GitHub ni una primera escritura en Firestore PRO.
Los identificadores personales están exclusivamente en `corrections.json` privado, fuera de Git.

## Resultado offline

- Se retira únicamente el participante indicado del catálogo de esa competición, conservando
  el orden y el contenido de todos los demás participantes y competiciones.
- Su índice sigue sin planes activos y registra un tombstone de desasignación para ese plan.
- El otro índice recibe la referencia del plan ya existente; no se regenera ni modifica ese plan.
- Cambian tres documentos lógicos: catálogo y dos índices. No hay nuevos usuarios, planes,
  sesiones, contraseñas o cambios en otros perfiles, repertorios o comentarios.
- Los 14 planes y sus snapshots completos se compararon profundamente y permanecen idénticos.

SHA GitHub original, sin recapturar: `0a754e2b58a929323946217a3be495944818ce89`.
Checksum de fuente original: `51c137d162d0cccddfc417673d7e506c6e29adf97becc77a3b160a39cf7ed70f`.
Checksum del paquete corregido: `411e0040abe8210d6c00671cf98a3af0dd8fef02988bd200114ed75e37aae4fc`.
Namespace candidato: `pgt_v2/import-411e0040abe8210d6c00671c`.

**Conversión apta: ready=true, cero bloqueos. Todavía no cargada ni activada en Firestore.**
Los paquetes bloqueados anteriores y el diagnóstico original se archivaron sin sobrescribirlos.
La captura cifrada original y el repositorio GitHub permanecen intactos.

## Repetibilidad y autorización

`ApprovedCorrections` admite únicamente esas dos operaciones. La regla privada fija SHA,
checksum original, competición, dos actores distintos y referencia de autorización. Comprueba
que ambos índices estaban vacíos, que el participante desasignado no tenía plan y que el otro sí.
Un origen, actor o estado distinto bloquea la transformación; no es reparación automática.

El conversor permite `--corrections-file <archivo_privado>`. La regla se incorpora al checksum
del bundle, pero el runner exige además el archivo privado `corrections.json` coincidente.
La verificación independiente compara contra el origen original más las tres modificaciones
exactamente autorizadas y rechaza cualquier cambio adicional. No hay endpoint de aplicación
que admita estas reglas y no se introducen en los bundles del runtime.

La autorización de estas correcciones no sirve como `production-authorization.json`: la primera
escritura en PRO sigue requiriendo permiso posterior y los controles de cuota, índices y destino.

## Plan sintético del paquete real corregido

Simulación local con transporte de prueba, no operaciones Google medidas:

| Métrica | Cantidad |
|---|---:|
| Lecturas lógicas estimadas | 1.005 |
| Escrituras de documentos simuladas | 260 |
| Borrados simulados | 0 |
| Peticiones al transporte sintético | 817 |
| Reservas conservadoras de lecturas del ledger | 1.428 |
| Presupuesto propuesto con margen: lecturas / escrituras / borrados | 1.835 / 375 / 0 |

Incluye checks iniciales de runner/librería, staging, activación y verificación profunda final.
Excluye reintentos, diagnósticos independientes, API administrativa de índices, tráfico concurrente
y cualquier facturación de entradas de índice. Las exenciones deben comprobarse y la cuota
real debe observarse en el momento de ejecutar. No se ha consumido cuota de Firestore PRO.

## Validación

38/38 pruebas dirigidas de migración/configuración correctas. Cubren la captura sin corregir
bloqueada, corrección explícita apta, fuente intacta, planes y contraseñas conservados, tombstone,
rechazo de otra captura/actor/DEV/campos adicionales y simulación de staging/activación/verificación.
Typecheck correcto. Evidencia privada local en `.qa/pro-preparation/approved-correction-integrity.json`;
`plan.json` se conserva junto al paquete cifrado fuera del repositorio.

Bater?a general posterior a la correcci?n: **396 casos, 395 aprobados, 0 fallidos y
1 omitido intencionalmente** (Chromium opt-in del validador, validado por separado en
la preparaci?n). Log local: `.qa/pro-preparation/unit-approved-corrections.log`.
