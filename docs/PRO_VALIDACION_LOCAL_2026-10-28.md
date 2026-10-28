# Validación de la preparación PRO — 28/10/2026

> Actualizaci?n posterior del propietario: las dos correcciones de asignaciones ya se
> aplicaron y verificaron offline. El paquete actual tiene cero bloqueos de conversi?n;
> GitHub y Firestore PRO no se han modificado. Los bloqueos descritos m?s abajo son
> el diagn?stico previo. Ver [resultado vigente](PRO_CORRECCIONES_AUTORIZADAS_2026-10-28.md).


## Resultado y límites

Soporte preparado en `feature/firestore-pro-preparation`, worktree aislado de la tarea QA.
Base de develop: `9e4c61464ab98c3f5415d0ffd16074f14da56e96`. Cambios locales revisables,
sin commits, push, PR, merge, publicación o cambios activos de infraestructura.

**Preparación de código validada localmente; migración real NO ejecutada.** El origen fijo
tiene tres bloqueos de datos. No se ha comprobado IAM, cuota, índices o destino vacío PRO
con Google real. No existe un validador remoto ni una URL de validación desplegada.

## Comprobaciones realizadas

| Comando / prueba | Resultado y alcance |
|---|---|
| npm test | Última batería completa: 390 casos, 389 aprobados, 0 fallidos y 1 skip intencional del navegador opt-in |
| PGT_VALIDATION_BROWSER=1 + tests/pro-validation.test.ts | 7/7, incluido el caso opt-in; Chromium real, datos y red sintéticos |
| Grupo dirigido de migración | 28/28 antes de añadir el caso CLI final; ledger, CAS, reanudación, credenciales, contenido e inventarios |
| Grupo final tests/v2-migration-pro + firestore-target + migration-private-path | 16/16, incluye el caso CLI posterior a la batería completa |
| npm run typecheck | Correcto tras los cambios finales |
| npm run build | PWA compilada, sin publicar |
| npm run check:worker | Bundle DEV real compilado |
| npm run test:runtime | Cuatro suites workerd/SQLite correctas; repetidas después de los cambios de entrada DEV |
| npm run check:pro | Configuración y bundles DEV/PRO/validador correctos, sin GitHub, fixtures o migrador en runtime |
| npm run test:pro:runtime | Miniflare PRO: login con hash existente, namespace, DO inerte, configuraciones cruzadas y seis manifiestos/punteros inconsistentes rechazados |
| npm run test:browser | PWA + Worker V2 locales: dos clientes, comentarios/CAS, consulta offline/PDF y ausencia de operaciones en reposo, correcto |
| 27 regresiones qa/remediation | 27/27; seguridad, conservación de borradores, conflictos e interfaz |
| npm run benchmark:firestore-v2 | Correcto, cero solicitudes Google; conserva costes sintéticos de consultas/comandos |
| Wrangler --dry-run, PRO/DEV/validador | Tres configuraciones compilan; solo salida local, sin despliegue |
| git diff --check | Correcto |
| Diff dominio/oráculos | Sin cambios de contenido en src/domain o fixtures congelados |

Los grupos dirigidos se solapan con la batería general: no sumarlos como casos distintos.
El skip de npm test no es una aprobación implícita; su comprobación explícita 7/7 consta aparte.

La invocación npm del grupo QA en el worktree no encontraba su CLI relativo porque se reutilizan
dependencias del checkout principal. Se ejecutó el mismo Playwright con
`node --experimental-strip-types ../../node_modules/@playwright/test/cli.js test --config=qa/remediation/playwright.config.mjs`.
En un checkout con npm ci, `npm run test:qa-remediation` usa su ruta normal.

## Hallazgos durante la preparación

- El primer npm test falló únicamente por CRLF introducido por Git al crear el worktree de Windows
  en los TXT cuyos bytes originales están congelados por SHA. Se restauraron exactamente los blobs
  originales y `.gitattributes` impide conversión de esos oráculos. No se regeneró ningún oráculo
  ni se alteró el guard; las 14 regresiones del dominio y la batería posterior pasan.
- Se corrigió un problema de tipos de Headers del test de navegador y una codificación BOM en
  el tooling nuevo. Typecheck y casos dirigidos finales pasan.
- Una revisión adicional encontró un `continue` que ocultaba un plan ausente después de señalar
  un índice inconsistente. Ahora informa ambos problemas sin reparar fuentes. Caso reproducible.
- El plan offline anterior no reservaba el máximo de las consultas como el ledger real. Ahora usa
  el mismo transporte presupuestado, incluyendo las comprobaciones de runner y librería, y separa
  lecturas lógicas de reservas. Un test confirma que el límite propuesto cubre las reservas.
- Se añadió una prueba real del CLI con `globalThis.fetch` deshabilitado: plan válido y plan
  bloqueado funcionan, no generan archivos de contraseñas PRO ni exponen el hash sintético.
- El guard de archivos privados ahora contempla el checkout común de Git además del worktree.

## Evidencias y repetición

Evidencias ignoradas por Git en este worktree:

- `.qa/pro-preparation/unit-final.log` — batería completa.
- `.qa/pro-preparation/source-inventory.json` — resumen no sensible de la captura fija.
- `.qa/pro-preparation/runtime-dev-observation.json` — diagnóstico remoto DEV, solo lectura.
- `.qa/pro-validation-local/inspector-{desktop,mobile}.png` — inspeccionadas visualmente.
- `.qa/remediation-2026-10-28/current/` — resultados y HTML de las 27 regresiones locales.
- `.worker-pro-build`, `.worker-dev-build`, `.worker-validation-build` — dry-run local.

Los paquetes reales, claves, hashes privados y diagnóstico identificativo están fuera del
repositorio, con ACL. No incluirlos en commits, capturas o informes compartidos.

Para repetir en un checkout limpio con Node 24 y Chromium instalado:

```text
npm ci
npm test
npm run typecheck
npm run build
npm run check:worker
npm run test:runtime
npm run check:pro
npm run test:pro:runtime
npm run test:browser
npm run test:qa-remediation
npm run benchmark:firestore-v2
```

Para el inspector completo en PowerShell:
`$env:PGT_VALIDATION_BROWSER='1'; node --experimental-strip-types --test tests/pro-validation.test.ts`.
No ejecutar la batería contra PRO real. Las simulaciones no acreditan IAM, integridad remota,
consumo facturable medido, migración real ni funcionamiento en Android/iOS físicos.

## Estado remoto y puertas de ejecución

El 28/10/2026 a las 20:11:31 UTC se consultó exclusivamente `/api/dev/runtime`: build
`9e4c61464ab98c3f5415d0ffd16074f14da56e96`, proyecto `pgt-bjj-dev` y revisión
`firestore-v2-20261026`. No se hicieron consultas de negocio ni mutaciones DEV.

PRO sigue sin cambios por esta tarea. La aplicación GitHub no se detuvo ni se bloquearon
sus escritores. Los únicos accesos a GitHub de datos fueron lecturas para fijar/clonar el SHA.

Informe de migración e integridad **remotas**: NO EJECUTADOS. Hay conversión offline con
18 hashes preservados y verificación de los 102 blobs; falta resolver dos índices y un plan
ausente, preparar configuración real y solicitar autorización de primera escritura.

Informe de despliegue: NO EJECUTADO. Workflow preparado, pero no publicado ni probado en Actions
remoto para esta rama. Interruptores, secretos y migraciones de Cloudflare reales pendientes de
revisión del propietario. No se ha creado PR develop → main ni autorizado su merge.

La recuperación y los cambios excluidos del SHA están documentados en
[PRO_EJECUCION_Y_RECUPERACION](PRO_EJECUCION_Y_RECUPERACION.md). GitHub permanece como histórico.
