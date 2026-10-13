# PGT — requisitos iniciales y reglas

Consultar **docs/REQUISITOS_PGT_APP.md** antes de implementar o modificar funcionalidades; contiene la especificación inicial completa versión 2.0. El propietario confirmó que la frase «No usar GitHub privado, GitHub REST API» en 2.1 es una errata: usar GitHub privado + REST API + Worker según el resto del documento. Conservar el documento adjunto íntegro.

Esta rama contiene únicamente la prueba bloqueante. No implementar aplicación completa ni afirmar viabilidad hasta validar el token del Worker en GitHub real, escrituras con SHA, rechazo de conflictos, token inválido/revocado y aislamiento PGT. La conexión del complemento GitHub no equivale al token privado que cargará el propietario.

Código en dmda92/pgt-bjj-planner, frontend src/ y API worker/. Datos de negocio exclusivamente en dmda92/pgt-bjj-data, PRIVADO, bajo PGT/. No cambiar su visibilidad. Tokens solo en secretos del Worker; no en bundle, Git, logs ni Markdown. Nunca acceso genérico de API, rutas arbitrarias ni elevación desde payload del cliente. Persistencia auxiliar SQLite DO solo sesiones, límites y coordinación.

Work no accede a Cloudflare ni configura o despliega. Solo propietario ejecuta deploy. Mantener Free; no pedir tarjeta. Usar JSON versionados con escrituras SHA condicionales y reintentos idempotentes; conflictos reales nunca se resuelven por último escritor. No eliminar cambios pendientes ni mezclar IndexedDB entre usuarios.

Tras superar el gate, implementar domain/application/infrastructure/ui. Fuente única de técnicas: posiciones a trabajar mínimos.json. No inventar, normalizar ni reconstruir order; arrays determinan orden y UUID son exclusivos de cada alumno. Generador puro: prioridades existentes ascendentes, primera/segunda, luego alternar retroceder 1 y avanzar 2 circularmente; completar todas las técnicas de cada pasada antes de avanzar. Continuidad entre sesiones, ejercicios y tiempos configurados por competición; dos ciclos y duración (2T+C)N+D(N-1). Snapshots se generan una vez y no se recalculan automáticamente. Distinguir desasignación de borrado entero.

Antes de subir: npm test, npm run typecheck, npm run build, npm run check:worker y npm run test:runtime (este último usa el bundle generado por check:worker). Documentar cobertura y límites; mocks no sustituyen integración real. Esta entrega no incorpora plantilla, registros públicos, trainer bootstrap, PWA, IndexedDB, planes ni PDF; no describirla como aplicación final.
