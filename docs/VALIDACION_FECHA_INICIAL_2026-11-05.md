# Fecha inicial del entrenamiento — DEV, 05/11/2026

Petición del propietario: incluir hoy Madrid en la selección automática de Mis planes y Entrenador/Entrenamiento del día, y desplegar DEV para su prueba. Corrige expresamente el requisito anterior de fecha estrictamente futura.

Feature `feature/training-day-include-today` creada desde main `1481bb7b31693e301e3228bbb0f5fc5c745e6397`. Destino PR: develop. Sin dependencias DEV importadas. Revisado el diff completo: solo consultas de fecha, texto explicativo, regresiones y documentación. No se modifican generador, snapshots, permisos, persistencia ni configuración de despliegue.

Cambios: comparación inclusiva en own-training-day, trainer-reports, trainer-agenda y búsqueda mensual del QueryCoordinator. Texto de Mis planes actualizado. Requisitos conservan el antecedente y añaden la corrección del propietario.

Validación local: `npm test`, `npm run typecheck`, `npm run build`, `npm run check:worker`, `npm run test:runtime` y `npm run test:browser` correctos. Regresiones específicas: 24/24 correctas, martes y jueves incluidos hasta terminar su día, días intermedios y sábado avanzan a la próxima sesión, último día del mes, torneo hoy, selección histórica/manual, aislamiento de propietario y conservación de sesiones múltiples. Chromium comprueba hoy en Mis planes con conexión y offline. Capturas de escritorio/móvil revisadas. El primer intento detectó una expectativa antigua en el fixture de agenda (enero aún tenía sesión); se corrigió a febrero y se repitió la batería completa.

Pruebas con datos sintéticos y Google/GitHub interceptados; no equivalen a QA remoto ni Safari/iOS físico. El informe histórico VALIDACION.md permanece intacto conforme a AGENTS.md.

Despliegue autorizado exclusivamente mediante PR a develop y Actions con wrangler.dev.jsonc, Worker pgt-github-probe-dev, proyecto pgt-bjj-dev y Environment development. Configuración existente conserva comprobación de cuenta, bindings y HEAD. No se ejecutan escrituras de QA remotas, migraciones, cambios de secretos ni operaciones PRO. Pendientes: CI de la PR, merge, verificación del build DEV y prueba funcional del propietario.
