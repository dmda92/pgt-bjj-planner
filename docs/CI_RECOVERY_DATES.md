# Corrección de fechas de pruebas de recuperación

El 19/10/2026 el job DEV falló en test-plan-recovery-runtime.mjs:142. El fixture comenzaba el 17/10/2026 y esperaba actualizar todas las sesiones, pero la aplicación preserva correctamente pasado/hoy según Europe/Madrid. El mismo defecto estaba en la prueba de recuperación de navegador.

Las dos pruebas comparten ahora recovery-calendar.mjs: inicio mañana Madrid y torneo 61 días después. Se conserva la cantidad de sesiones, ejercicios, tamaño suficiente para disparar PLAN_TOO_LARGE, las aserciones de recuperación completa, CAS, idempotencia, aislamiento del transporte GitHub y exportación offline. Los torneos cortos y sus etiquetas de navegador usan el mismo calendario relativo. No se cambia ninguna regla de negocio ni se omiten checks.

Rama feature/fix-ci-dates desde main 0714047; PR dirigida a develop. La PR anterior #1 ya estaba fusionada por el propietario al comenzar esta corrección. Sin merge automático ni despliegue. Wrangler y workflows PRO/DEV permanecen intactos. Datos exclusivamente sintéticos.

Validación completa y resultados definitivos en la descripción de la PR. En local se reintenta instalar Chromium; la descarga del navegador devuelve un ZIP inválido, por lo que la validación de navegador requiere el runner de Actions. No equiparar comprobación sintáctica con ejecución browser.
