# Evidencias iniciales — migración Firestore DEV

Fecha 20/10/2026; Node 24.19.0. Base main `3b8125cb362f665f908e4028d54514f65f00459a`. Solo datos sintéticos en memoria/IndexedDB/workerd local. Sin lectura del repo privado de datos y sin credenciales cloud cargadas en el checkout.

## Antes de modificar persistencia

| Comprobación | Resultado |
| --- | --- |
| npm ci | OK, 94 paquetes instalados según lockfile |
| npm test original | 117/117 pasan, 0 omitidas |
| npm run typecheck | OK |
| npm run build | OK, Vite/PWA generados localmente |
| npm run check:worker | OK, bundle esbuild local |
| npm run test:runtime | OK, workerd/SQLite, PBKDF2 nativo/fallback, sesión, aislamiento, comentarios, competición, histórico, CAS, borrado, roles y recuperación de planes |
| npm run test:performance | OK, benchmark sintético con transporte interceptado; no son medidas Firestore ni producción |
| node scripts/check-dev-config.mjs | OK, destino DEV y binding SQLite local |
| npm run test:browser | Bloqueado localmente: falta Chromium; instalación Playwright intentada y falló al descargar Chrome for Testing 145.0.7632.6, v1208. La cadena no ejecutó sus suites posteriores |

Runtime comprobó recuperación con catálogo vacío y una proyección sintética de 16.842.193 bytes rechazada sin perder las fuentes. Estas pruebas interceptan GitHub y **no** verifican Firestore remoto.

## Regresiones añadidas

`node --experimental-strip-types --test tests/firestore-domain-regression.test.ts`: 14/14 pasan (12 fixtures completos, integridad del dominio y secuencia circular). Incluidas en `npm test` por su patrón actual; no se modifica CI para ejecutarlas.

- Oráculo capturado contra los archivos sin modificar de main, con hashes SHA-256 de planner, plan-continuity, plan-text-updates y models.
- Comparación exacta del objeto completo generado/recalculado, no solo totales ni ausencia de excepción. Tiempos, cobertura, cursores/checkpoints y entradas originales incluidos.
- Protege hoy/pasado, torneo acabado, continuidad tras borrados, vacío/cursor corrupto, idempotencia, prioridades no consecutivas, posición partida, año bisiesto y descansos históricos cero.
- Datos y UUID sintéticos fijos; no datos de alumnos. No se modifican las fuentes de dominio, UI, Worker, configuraciones ni workflows en esta fase.

Resultados de la suite completa ampliada y CI de esta PR se registrarán tras la ejecución. No tratar el CI verde del commit anterior como evidencia del commit nuevo.

## Gates aún pendientes (no superados)

1. Configuración y verificación de identidad, base, región y facturación DEV.
2. Implementación Firestore; tests de esquema/fragmentación >1 MiB, CAS/transacciones y migrador dry-run/idempotencia/integridad.
3. Ausencia de ruta GitHub y de mutaciones offline en la nueva ejecución DEV; persistencia confirmada antes de éxito y recuperación ante fallo intermedio/ACK perdido.
4. WebSocket autenticado y revocable, reconexión, duplicados, orden de eventos, cambio de sesión y permisos negativos.
5. Dos contextos de navegador, roles alumno/entrenador, edición técnica→ficha del profesor, comentarios→alumno, asignación→entrenamiento del día, borrado, futuro protegido y concurrencia; registrar latencia p50/p95 y contadores reales.
6. DEV desplegado tras pruebas y revisión, sin referencias operativas a pgt-bjj-pro ni cambios en main/Worker PRO/datos reales.
7. Documentos definitivos de esquema/índices, costes medidos, operación/migración, cutover futuro y rollback; solo existe propuesta inicial de arquitectura.

La fase inicial está preparada para revisión; no es una migración terminada. La PR debe permanecer borrador y no integrarse/desplegarse hasta completar las fases restantes y la configuración manual indicada en FIRESTORE_CONFIGURACION_DEV.md.
