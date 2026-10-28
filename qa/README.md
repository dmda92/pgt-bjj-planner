# Campañas E2E de PGT

Infraestructura de Playwright Test para protocolo DOCX, DEV real y Worker local con
Firestore sintético. No modifica la aplicación para hacer pasar pruebas ni despliega.
Procedimiento completo: `.agents/skills/pgt-e2e-qa/SKILL.md`.

```powershell
npm ci
node qa/run.mjs new --campaign mi-campana --document "C:/ruta/protocolo.docx"
node qa/run.mjs run --campaign mi-campana
node qa/run.mjs run --campaign mi-campana --block COM
node qa/run.mjs run --campaign mi-campana --case "COM 11"
node qa/run.mjs run --campaign mi-campana --failed
node qa/run.mjs run --campaign mi-campana --pending
node qa/run.mjs status --campaign mi-campana
node qa/run.mjs report --campaign mi-campana
```

Las implementaciones de casos en `playwright/tests` corresponden al protocolo de
esta campaña. Para un documento distinto, el agente revisa criterios y amplía/adapta
los casos conservando fixtures, guardas, resultados y reporting. No reutilizar una
aprobación solo por coincidir el ID. Un documento no reconocido requiere adaptar el
extractor, nunca omitir fichas silenciosamente.

Configurar `.qa/credentials.local.json` con `baseURL` DEV exacta y `trainer.mail` /
`trainer.password`. Esa carpeta está ignorada. Los alumnos nuevos se registran por UI,
y las credenciales/perfiles persistentes quedan privados dentro de cada campaña.

`remote-*` usa DEV real, con guardas que impiden mutaciones de competiciones ajenas.
`plans` / `faults` usa un servidor PWA + Worker workerd/SQLite local con transporte
Firestore interceptado. Cada ficha identifica su entorno y criterios pendientes.
No ejecutar en paralelo suites que abran los mismos perfiles o modifiquen un catálogo
compartido. Los datos QA se conservan para reanudar y limpiar por vías soportadas.

El informe HTML de cada ejecución está en `.qa/campaigns/<id>/playwright-report-*`.
Los resultados y evidencias por intento no se heredan entre campañas. Ejecutar el
saneador de `tools/` antes de compartir cualquier artefacto, especialmente trazas.
DOCX, inventario de incidencias y métricas: consultar `tools/README.md`.
