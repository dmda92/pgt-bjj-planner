# Fecha inicial del entrenamiento — DEV, 05/11/2026

Petición del propietario: incluir hoy Madrid en la selección automática de Mis planes y Entrenador/Entrenamiento del día, y desplegar DEV para su prueba. Corrige expresamente el requisito anterior de fecha estrictamente futura.

Feature `feature/training-day-include-today` creada desde main `1481bb7b31693e301e3228bbb0f5fc5c745e6397`. Destino PR: develop. Sin dependencias DEV importadas. Revisado el diff completo: solo consultas de fecha, texto explicativo, regresiones y documentación. No se modifican generador, snapshots, permisos, persistencia ni configuración de despliegue.

Cambios: comparación inclusiva en own-training-day, trainer-reports, trainer-agenda y búsqueda mensual del QueryCoordinator. Texto de Mis planes actualizado. Requisitos conservan el antecedente y añaden la corrección del propietario.

Validación local: `npm test`, `npm run typecheck`, `npm run build`, `npm run check:worker`, `npm run test:runtime` y `npm run test:browser` correctos. Regresiones específicas: 24/24 correctas, martes y jueves incluidos hasta terminar su día, días intermedios y sábado avanzan a la próxima sesión, último día del mes, torneo hoy, selección histórica/manual, aislamiento de propietario y conservación de sesiones múltiples. Chromium comprueba hoy en Mis planes con conexión y offline. Capturas de escritorio/móvil revisadas. El primer intento detectó una expectativa antigua en el fixture de agenda (enero aún tenía sesión); se corrigió a febrero y se repitió la batería completa.

Pruebas con datos sintéticos y Google/GitHub interceptados; no equivalen a QA remoto ni Safari/iOS físico. El informe histórico VALIDACION.md permanece intacto conforme a AGENTS.md.

Despliegue autorizado exclusivamente mediante PR a develop y Actions con wrangler.dev.jsonc, Worker pgt-github-probe-dev, proyecto pgt-bjj-dev y Environment development. Configuración existente conserva comprobación de cuenta, bindings y HEAD. No se ejecutan escrituras de QA remotas, migraciones, cambios de secretos ni operaciones PRO. Pendientes: CI de la PR, merge, verificación del build DEV y prueba funcional del propietario.

## Cierre DEV y promoción PRO autorizada

PR #35 integrada en develop como 822586fcb56b3def63d24bf86fa1edaee29ef102. CI de PR 41978171157 y despliegue DEV 41979014726 correctos. Endpoint de runtime verificado con build/domainBuild coincidentes y proyecto pgt-bjj-dev; bundle remoto contiene el texto nuevo. El propietario confirma el funcionamiento y solicita pasar esta corrección a producción.

Revisión completa contra main 1481bb7: la feature original contiene exclusivamente la corrección, sus regresiones y documentación. No incorpora PR #34 ni otros cambios de develop. Promoción feature/training-day-include-today → main. Código idéntico al probado en DEV; solo se añade esta evidencia documental. Se conserva package-lock.json sin cambios.

Destino de publicación: Worker pgt-github-probe, entrada worker/pro.ts, wrangler.jsonc y proyecto pgt-bjj-pro. Se usa el workflow PRO existente con validación de HEAD y credenciales de cuenta ya configuradas; no se modifican workflow, cuenta, bindings, migraciones, secretos ni datos de negocio. La comprobación aislada check-pro-config valida el destino; CI comprueba el runtime PRO. Pendientes antes del cierre: CI de promoción, merge autorizado y verificación remota de build/frontend. No se ejecuta una campaña QA sobre cuentas reales.
