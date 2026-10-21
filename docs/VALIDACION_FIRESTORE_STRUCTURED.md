# Validación Firestore estructurado — 21/10/2026

## Estado antes del despliegue

Implementación exclusiva en feature/firestore-structured-model, creada desde main y con importación posterior y trazable del árbol DEV de PR #6/#10/#11. Se prepara PR hacia develop sin fusionar. No se modificaron src/domain, Worker/API/provider PRO, wrangler.jsonc ni el workflow PRO respecto de main.

Validación local: 165 pruebas unitarias satisfactorias, incluidos doce oráculos completos congelados y siete pruebas nuevas del repositorio nativo. Typecheck, build PWA, compilación Worker, runtimes anteriores, diagnóstico DEV interceptado y runtime nativo satisfactorios. Este último verifica alta pública, roles, aislamiento, WebSocket autorizado, plan generado exacto, cambios futuros, eliminación estructural, histórico protegido, CAS, desasignación y limpieza física de cuentas, credenciales, revisiones y referencias de QA. Cada llamada comprueba el límite Free de 50 subrequests. El bundle DEV excluye el provider de archivos GitHub y las plantillas sintéticas de tests.

Estas pruebas usan Google interceptado. No acreditan todavía integración real, limpieza remota ni aceptación en navegador. Chromium se ejecuta en Actions Ubuntu 24.04 porque el navegador no está instalado en el contenedor de trabajo. No afirmar aceptación Safari/iOS ni dispositivos físicos.

## Gate remoto preparado

El workflow DEV ejecuta todas las pruebas históricas de navegador/PDF y el escenario online aislado antes de desplegar. Solo develop y la feature exacta autorizada pueden desplegar en el Worker DEV, con cuenta esperada, HEAD actual, proyecto fijo y credencial limitada a DEV. No requiere merge de la PR.

Después del deploy: diagnóstico Firestore real; inventario completo y legado; eliminación condicional de legado autorizado; carga y roundtrip del catálogo original privado (17 posiciones/36 técnicas); QA real con tres contextos de navegador; limpieza de todos los datos de esa ejecución; inventario final sin legado, QA ni padres huérfanos. Los informes de artifacts/ contienen conteos, huellas, resultados y latencias sin credenciales ni el catálogo privado.

La QA de navegador cubre alta pública, catálogo recibido, perfil persistente, rechazo de elevación por payload, asignación/revocación de rol y sesión, autenticación de entrenador, doce autosaves recibidos sin refrescar, borrador fallido/exportación/reintento explícito, aislamiento, competición/inscripción, plan exacto, PDF descargable, comentario, recálculo de eliminación, histórico protegido, conflicto 409, desconexión sin replay, desasignación y revocación de WebSocket. El borrado administrativo de cuentas tiene comprobación física en runtime e inventario final real. No se añadió una funcionalidad pública nueva de borrado de cuentas.

## Evidencia remota

Commit validado: d1ae7e7add4753545a9a654c45860a9727484fed. Ejecución push [39582999031](https://github.com/dmda92/pgt-bjj-planner/actions/runs/39582999031): validate y validate-online satisfactorios. La ejecución PR [39583006598](https://github.com/dmda92/pgt-bjj-planner/actions/runs/39583006598) también pasó. Se conservan las evidencias aisladas en [evidence/structured-isolated-2026-10-21](evidence/structured-isolated-2026-10-21/firestore-local-browser.json): tres contextos Chromium, 12 cambios, p50 934 ms/p95 942 ms, PDF, permisos, autenticación y limpieza satisfactorios. **Google interceptado; estas medidas no son latencias de Firestore DEV.** Las capturas emparejadas contienen únicamente el texto sintético de la descripción, sin publicar el catálogo privado.

El job deploy-dev fue rechazado antes de iniciar un runner. Anotación literal de GitHub: `Branch "feature/firestore-structured-model" is not allowed to deploy to development due to environment protection rules.` La segunda anotación indica `The deployment was rejected or didn't satisfy other protection rules.` No se ejecutó Wrangler ni se realizó inventario, limpieza, carga del catálogo o integración real de esta implementación.

Configuración que falta: en Settings → Environments → development → Deployment branches and tags, permitir la rama exacta **feature/firestore-structured-model**, conservando las otras protecciones y develop. Después volver a ejecutar el workflow DEV de la feature actual. No cambiar el Environment de producción ni fusionar la PR para sortear esta protección. El conector GitHub de esta sesión no permite administrar esas reglas y el navegador no dispone de sesión autenticada. No se intentó eludir la restricción.

Comprobación final antes de documentar el bloqueo: main permanece en 3b8125cb362f665f908e4028d54514f65f00459a y develop en f0080f89889503cdd25cc7d2f0b42f183c423b40. La PR #12 está abierta y sin conflictos; no se fusionó. **La tarea sigue pendiente de operaciones y aceptación reales en DEV.**

Revisión adicional independiente: runtime con cinco planes activos simultáneos dentro del presupuesto de 50 subrequests por petición; limpieza física también de revisiones de planes interrumpidos conocidos por el marcador QA. El inventario final preparado detecta documentos sintéticos nativos además de marcadores QA y padres huérfanos. Estas comprobaciones adicionales siguen siendo aisladas hasta desbloquear el Environment.
