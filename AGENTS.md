# PGT

Consultar **docs/REQUISITOS_PGT_APP.md**, especificación inicial íntegra, antes de implementar o modificar funcionalidades. Prevalece sobre decisiones de implementación.

Estado: solo prueba de concepto bloqueante de OAuth/Graph y autorización PGT. No implementar la aplicación completa ni afirmar viabilidad hasta verificar cuenta personal real, renovación persistente, revocación, lectura/escritura, escritorio, Android e iOS.

Frontend y Worker pertenecen al mismo repositorio. Work no accede a cuentas Cloudflare ni despliega. No versionar secretos, tokens, contraseñas ni logs privados. OneDrive es la única fuente de datos de negocio; Durable Objects solo coordina tokens cifrados, sesiones, estados OAuth y límites de frecuencia. Nada de Graph genérico ni rutas arbitrarias desde cliente.

La fuente oficial es `posiciones a trabajar mínimos.json`; no inventar técnicas. Arrays determinan el orden, sin reconstruir `order`. Generador futuro puro: prioridades existentes ascendentes, primera/segunda, después retroceder 1 y avanzar 2 circularmente; completar cada pasada antes de avanzar y mantener continuidad. Los ejercicios y tiempos proceden de la competición. Nunca regenerar automáticamente snapshots. Usar domain/application/infrastructure/ui al desarrollar la aplicación.

Antes de subir cambios: npm test, npm run typecheck y npm run check:worker. La prueba local no valida Microsoft real ni cuotas efectivas; consignar resultados pendientes. Mantener controles de versión y evitar pérdida de datos, mezcla entre usuarios y secretos en el navegador. No sustituir proveedor ni introducir otra BD de negocio.
