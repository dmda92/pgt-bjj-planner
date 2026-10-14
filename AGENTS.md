# PGT — requisitos iniciales y reglas

Consultar **docs/REQUISITOS_PGT_APP.md** antes de implementar o modificar funcionalidades; contiene la especificación inicial completa versión 2.0. El propietario confirmó que la frase «No usar GitHub privado, GitHub REST API» en 2.1 es una errata: usar GitHub privado + REST API + Worker según el resto del documento. Conservar el documento adjunto íntegro.

El propietario declaró terminadas las pruebas de viabilidad el 13 de octubre de 2026 tras confirmar lectura, escritura, login, conflictos, aislamiento, borrado y sincronización móvil/ordenador. Autorizó desarrollar la aplicación. Conservar esta evidencia sin afirmar que las pruebas locales equivalen a integración remota ni dar por probadas comprobaciones que no realizó. La conexión del complemento GitHub no equivale al token privado del Worker.

Código en dmda92/pgt-bjj-planner, frontend src/ y API worker/. Datos de negocio exclusivamente en dmda92/pgt-bjj-data, PRIVADO, bajo PGT/. No cambiar su visibilidad. Tokens solo en secretos del Worker; no en bundle, Git, logs ni Markdown. Nunca acceso genérico de API, rutas arbitrarias ni elevación desde payload del cliente. Persistencia auxiliar SQLite DO solo sesiones, límites y coordinación.

Work no accede a Cloudflare ni configura o despliega. Solo propietario ejecuta deploy. Mantener Free; no pedir tarjeta. Usar JSON versionados con escrituras SHA condicionales y reintentos idempotentes; conflictos reales nunca se resuelven por último escritor. No eliminar cambios pendientes ni mezclar IndexedDB entre usuarios.

Tras superar el gate, implementar domain/application/infrastructure/ui. Fuente única de técnicas: posiciones a trabajar mínimos.json. No inventar, normalizar ni reconstruir order; arrays determinan orden y UUID son exclusivos de cada alumno. Generador puro: prioridades existentes ascendentes, primera/segunda, luego alternar retroceder 1 y avanzar 2 circularmente; completar todas las técnicas de cada pasada antes de avanzar. Continuidad entre sesiones, ejercicios y tiempos configurados por competición; dos ciclos y duración (2T+C)N+D(N-1). Snapshots se generan una vez y no se recalculan automáticamente. Distinguir desasignación de borrado entero.

Antes de subir: npm test, npm run typecheck, npm run build, npm run check:worker y npm run test:runtime (este último usa el bundle generado por check:worker). Documentar cobertura y límites; mocks no sustituyen integración real. La aplicación incorpora plantilla oficial, registro, bootstrap, PWA, IndexedDB, planes y PDF. Registrar pruebas ejecutadas y pendientes en docs/VALIDACION.md. No afirmar cobertura numérica ni aceptación en Safari/iOS sin medirlas.

## Identidad visual del frontend

Antes de modificar UI consultar `docs/DISENO_FRONTEND.md` y `.agents/skills/frontend-design/SKILL.md` (skill oficial de Anthropic, incorporada con licencia). Usar fuentes locales, paleta pizarra/azul y superficies claras conforme a las capturas elegidas por el propietario; no derivar los colores del logo PGT. Mantener el dashboard de entrenador, foco visible, tamaños táctiles y movimiento reducido. Los resúmenes son cálculos de datos ya autorizados; no inventar actividad, porcentajes globales, tendencias ni endpoints. No modificar autenticación, permisos, sincronización, generador o PDF para conseguir un efecto visual. La nueva consulta de cobertura es exclusiva del entrenador y calcula métricas sobre snapshots autorizados, sin regenerar planes ni introducir endpoints. Ejecutar también `npm run test:browser` tras cambios de UI y revisar capturas de escritorio y móvil.

Validación de la dirección actual (capturas de referencia y cobertura) en `docs/VALIDACION_REDISENO.md`; rediseño anterior en `docs/VALIDACION_DISENO.md`; el informe histórico `docs/VALIDACION.md` permanece intacto.

Cambios autorizados el 14/10/2026: PRO 01 (refresco de todos los campos del perfil tras sincronizar, preservando borradores sin guardar) y entrenadores como participantes de competiciones. Detalles y validación en `docs/CAMBIOS_PERFIL_PARTICIPANTES.md`. No filtrar entrenadores del selector de participantes.
