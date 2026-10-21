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

Pendiente de la primera ejecución de la feature. Sustituir este estado por los IDs y resultados efectivos al completarse, sin confundir publicación con despliegue.
