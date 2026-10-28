# PGT — validación del rediseño visual · 14/10/2026

Aplicadas las instrucciones oficiales de `frontend-design` de Anthropic, incorporadas junto con su licencia en
`.agents/skills/frontend-design/`. Identidad y reglas futuras en `docs/DISENO_FRONTEND.md`, referenciada desde
AGENTS.md. Paleta del logo PGT, Barlow/Barlow Condensed locales, navegación lateral en escritorio y navegación completa
en móvil, resumen de datos reales, listado de equipo y ficha con progreso; zona separada de competiciones. Se conservan
las acciones y restricciones originales. Los archivos de Worker, dominio, cliente de sincronización, IndexedDB y
exportación PDF son idénticos a `7ac890f`.

Verificaciones ejecutadas sobre esta versión:

- `npm test`: 47/47 correctas, sin omitidas.
- `npm run typecheck`, `npm run build`, `npm run check:worker`: correctos.
- `npm run test:runtime`: workerd + SQLite DO, WebCrypto nativo y fallback bajo límite inyectado; flujos de aplicación
  correctos, GitHub interceptado localmente. Sin Cloudflare ni datos reales.
- `npm run test:browser`: Chromium 153 con Playwright, API local y datos sintéticos. Conserva registro/login, IndexedDB,
  offline/recarga, cambios independientes/conflictos, cambio A→B/restauración, competición/asignación, plan/PDF offline,
  edición manual, contraseña y coordinación de pestañas. Nuevas comprobaciones: búsqueda de alumnos sin coincidencias,
  selección accesible, porcentaje real (2 de 36 técnicas), escritura de comentario sin alterar descripción y resumen que
  pasa de 1/0/0 a 1/1/1 tras crear/asignar competición.
- Dashboard sin desbordamiento horizontal a 360, 390, 768, 1280 y 1440 px; movimiento reducido desactiva transiciones.
  Capturas de dashboard sin ficha, ficha seleccionada y competición, más alumno/escritorio/móvil, generadas en
  `.browser-artifacts/`. Revisadas visualmente las capturas de dashboard escritorio y móvil: jerarquía, campos,
  selección y navegación completos. El build precachea las tres fuentes locales con sus licencias; no introduce fuentes
  remotas ni dependencias de ejecución.

El Chromium heredado del entorno estaba truncado y la descarga directa de Playwright falló. Se obtuvo un ejecutable
completo mediante el paquete de herramientas `@sparticuz/chromium` fuera del proyecto. No se añadió a package.json ni al
repositorio; después la batería completa de navegador terminó correctamente. Esta reparación de la herramienta de QA no
altera la aplicación.

Queda la aceptación del nuevo diseño en los teléfonos físicos del propietario y Safari/iOS. Los anchos emulados no
acreditan pruebas de Android o iPhone reales. No se ha accedido a Cloudflare ni desplegado la versión.

