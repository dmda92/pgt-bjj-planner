# INTERNAL_ERROR al desasignar participantes migrados — 26/10/2026

## Diagnóstico reproducido

El índice de asignaciones admite `pendingPlanIds` ausente. Los datos migrados pueden
tener ese formato, mientras que crear un plan mediante el backend actual añade un
array, aunque quede vacío. La desasignación hacía siempre esta asignación:

```ts
assignment.pendingPlanIds = assignment.pendingPlanIds?.filter(p => p !== id);
```

Si la propiedad faltaba, se creaba con valor `undefined`. El empaquetado nativo rechaza
ese valor con `PLAN_NATIVE_VALUE`; la API oculta la excepción no clasificada mediante
HTTP 500 `INTERNAL_ERROR`. El fallo sucede antes de publicar atómicamente el catálogo,
las asignaciones y los borrados. La espera no implica que se haya confirmado el cambio.

Se reproduce localmente con transporte Firestore sintético: crear una competición,
restaurar la forma migrada del índice sin ese campo, usar un coordinador nuevo y
desasignar. No se ha inspeccionado la petición concreta del propietario ni ejecutado
la operación sobre sus datos. Las pruebas previas de desasignación usaban índices
recién generados y por eso no detectaban el caso.

## Corrección

Filtrar el campo solo cuando existe. Una propiedad ausente permanece ausente.
No se relaja el empaquetado ni se ignoran valores inválidos de forma general.
Se conservan CAS, publicación atómica, tombstone, recuperación y reglas de negocio.
No hace falta reparar ni volver a migrar los datos.

Prueba de regresión: índice sin metadatos opcionales, desasignación, borrado del plan
individual, tombstone, reintento idempotente sin escrituras repetidas, reasignación
y conservación literal del plan del otro participante. Datos exclusivamente sintéticos.

## Validación y alcance

Prueba dirigida correcta. Validación completa correcta: npm test 340/340,
typecheck, build, check:worker y las tres suites test:runtime. No se ha repetido
test:browser porque no hay cambios de UI; no se afirma validación remota del fallo.
Sin cambios de UI ni de dominio. Revisión del diff y git diff --check correctas.
Preparado en la feature existente `fetaure/optimizacionFirestore`. El propietario
autoriza ahora integrar por PR a develop y desplegar exclusivamente DEV tras CI.
Destino: pgt-github-probe-dev, wrangler.dev.jsonc, Firestore pgt-bjj-dev; el workflow
comprueba cuenta, HEAD y versión publicada sin ejecutar mutaciones de datos para QA.
La publicación y su verificación quedan pendientes al preparar esta entrega.
Sin cambios en main, PRO o datos GitHub/Firestore reales.
La modificación previa del propietario de la skill frontend-design permanece intacta.
