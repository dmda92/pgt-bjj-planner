# Migración PRO ejecutada y verificada

El propietario autorizó expresamente carga, verificación y activación mediante «dale»
tras recibir SHA, alcance y presupuesto. Operación realizada el 28/10/2026.

## Resultado remoto real

- Proyecto/base: `pgt-bjj-pro / (default)`, Native/Standard, europe-west1.
- Fuente inmutable: `dmda92/pgt-bjj-data`, commit `0a754e2b58a929323946217a3be495944818ce89`.
- Checksum: `411e0040abe8210d6c00671cf98a3af0dd8fef02988bd200114ed75e37aae4fc`.
- Namespace activado: `pgt_v2/import-411e0040abe8210d6c00671c`.
- Staging: `verified-staging`; activación: `activated`; comparación final: `verified-read-only`.
- 18 usuarios, 14 planes, 3 meses de agenda derivados; sin sesiones nuevas ni recálculo histórico.

La comparación offline independiente contra la captura original conserva perfiles,
roles y hashes de contraseña, UUID, orden, técnicas, comentarios, catálogo y planes.
Las únicas diferencias de origen autorizadas son la desasignación de Pilar y la referencia
del plan existente de Rodrigo (catálogo y dos índices). La verificación remota descarta
cachés y compara hashes canónicos del contenido de agregados y planes completos,
proyecciones y agenda, además de los inventarios exactos de agregados y planes.
Las credenciales privadas no se incluyen en informes.

## Contabilidad

| Paso | Lecturas reservadas acumuladas | Escrituras acumuladas | Borrados |
|---|---:|---:|---:|
| Staging verificado | 692 | 258 | 0 |
| Activación CAS | 1.300 | 260 | 0 |
| Verificación final independiente | 1.642 | 260 | 0 |

821 peticiones acumuladas contabilizadas por el ledger de datos. Los contadores son
reservas conservadoras previas a las peticiones, no métricas de facturación de Google.
No incluyen OAuth ni consultas administrativas de metadatos/índices. Presupuesto aprobado:
1.835 lecturas / 375 escrituras / cero borrados. No se inventó un contador de consumo:
la disponibilidad se basó en declaración del propietario de base nueva nunca usada,
captura sin métricas y diagnóstico remoto de destino vacío. El grant registra expresamente
que no es una medición de cuota.

## Incidencia inicial resuelta antes de escribir

El primer intento falló en el guard de destino porque Google omite `collectionIds`
cuando la lista está vacía. No escribió documentos. Se añadió una regresión local:
falló antes de corregir y pasó después. Se acepta únicamente omisión como lista vacía;
null, tipos inválidos, colecciones ajenas y paginación pendiente siguen rechazados.
17/17 pruebas de migración PRO y typecheck correctos tras la corrección. Se conservó
el mismo paquete y ledger; el intento fallido está incluido en las reservas acumuladas.

## Recursos y siguientes pasos

- GitHub de datos no modificado ni recapturado. Cambios posteriores al SHA excluidos.
- Worker PRO antiguo sigue funcionando con GitHub; activar el namespace no lo cambia.
- Firestore DEV y Workers DEV/PRO no fueron modificados ni desplegados.
- No se configuraron secretos/bindings activos ni se fusionó código.
- Evidencias privadas: stage-result-*, activate-result-* y verify-* en el directorio
  privado de migración; ledger persistente compartido a nivel de proyecto.
- Pendiente: dominio exclusivo y Cloudflare Access del validador, autorización separada
  de su despliegue y comprobación visual real. No existe todavía URL de validación.
- Despliegue normal y merge a main pendientes de autorización específica posterior.

Ante problemas, conservar namespace, ledger, fuente cifrada y claves fuera de Git.
No borrar ni repetir la migración para incorporar cambios posteriores. El sistema en
servicio sigue siendo GitHub mientras no se autorice y publique el runtime nuevo.
