# Estado de validación — 13/10/2026

Esta entrega es exclusivamente la prueba previa; no la aplicación completa.

- GitHub: conexión dmda92, repositorio dmda92/pgt-bjj-planner, permisos pull/push/admin confirmados.
- Requisitos: nueva versión íntegra en docs/REQUISITOS_PGT_APP.md; referencia expresa en AGENTS.md.
- Tests: 15 casos con Microsoft Graph simulado: validación de correo, control de acceso, hashes, cifrado autenticado, versiones y creación, API, estados OAuth, persistencia/rotación serializada, revocación, cuenta propietaria, sesiones y flujo JSON completo.
- TypeScript: comprobación estática prevista como requisito de entrega.
- Compilación Worker: Wrangler dry-run local, sin publicar ni credenciales Cloudflare.
- Simulador local: no arrancó en este entorno; error uv_interface_addresses / Unknown system error 1 al consultar interfaces de red. No se ha probado el runtime Cloudflare real ni se afirma compatibilidad efectiva hasta la ejecución del propietario.
- Microsoft real: pendiente registro de aplicación, secretos configurados por propietario, consentimiento, cuenta personal, lectura/escritura, conflictos reales, renovación persistente y revocación.
- Escritorio, Android, iOS: pendientes pruebas reales siguiendo PRUEBA_ONEDRIVE.md. La instalación PWA pertenece a la app posterior; este cliente mínimo de navegador no es todavía una PWA.
- Cloudflare: Work no ha accedido a cuenta, creado proyecto ni desplegado. Solo se ha consultado documentación pública y preparado código/configuración local.
- Aplicación completa, npm run build/dist, IndexedDB, generador, UI alumno/entrenador, sincronización completa y PDF: no iniciados, bloqueados hasta superar prueba real.

No se han pedido ni recibido secretos. Los únicos datos a devolver son identificadores públicos y resultados sanitizados. No dar por viable la arquitectura con mocks ni afirmar que la aplicación está terminada.
