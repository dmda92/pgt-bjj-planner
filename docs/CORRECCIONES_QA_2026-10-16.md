# Correcciones QA de los cinco bugs — 16/10/2026

Base auditada y HEAD remoto al recuperar: `83d337715b764a95f22f9140179a01731438c435`.
Recuperación: checkout original, rama `fix/qa-five-bugs`, cambios sin confirmar. No se reconstruyeron las correcciones.
Publicación prevista por push a main y `.github/workflows/cloudflare.yml`.

| Bug     | Causa y solución                                                                                                                                                                                                                               | Archivos principales                                                                      | Regresión                                                                                                                                                                         |
|---------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| BUG-005 | La proyección del plan excedía 4 MiB y abortaba el snapshot o la confirmación de fuentes. Se informa `planIssues`, se conserva el último plan válido y se permite corregir fuentes con CAS; sincronización incompleta hasta recuperar el plan. | worker/application.ts, src/application/client.ts, src/domain/plan-issues.ts, src/main.tsx | Descripciones/comentarios, varios planes, histórico, tres contextos, offline/reload, login bloqueado, conflictos, aislamiento, idempotencia; plan de 16.842.193 bytes en workerd. |
| BUG-001 | Generar con catálogo sin técnicas bloqueaba la restauración. Snapshot completo con aviso recuperable; no crear plan ficticio, generar tras añadir técnicas.                                                                                    | worker/application.ts, src/application/client.ts                                          | Catálogo vacío y posiciones vacías, login, reparación desde UI, generación y repetición idempotente.                                                                              |
| BUG-002 | min/max/step del input excluían pesos válidos. Validación explícita de decimal, coma española, intervalo abierto (0,500) sin redondeo.                                                                                                         | src/main.tsx, src/application/weight-input.ts                                             | 0.01,71.55,499.99,71,55,vacío; inválidos; persistencia offline y sincronización en dos contextos.                                                                                 |
| BUG-003 | Cero días llegaba a validación general. Error asociado al grupo y foco en primera casilla; no enviar POST inválido. Backend conserva validación.                                                                                               | src/main.tsx                                                                              | Cero POST con cero días; uno, varios y todos válidos; backend 400 para cero.                                                                                                      |
| BUG-004 | Alcance simplificado autorizado: Barlow local, validación previa de cobertura y error explícito para caracteres no compatibles; sin fuentes adicionales.                                                                                       | src/infrastructure/pdf.ts, pdf-font-coverage.json                                         | Español, puntuación, enlaces, textos largos, snapshot inmutable, primera exportación offline y rechazo sin pérdida silenciosa.                                                    |

## Verificación repetida al recuperar

Repetidos y correctos antes de publicar: npm test (104/104), typecheck, build, check:worker, test:runtime, test:browser
y test:performance. Extracción PDF verificada con pdftotext y revisión visual del PDF Unicode. Chromium recuperado de la
ejecución anterior; la descarga predeterminada de Playwright no estaba disponible localmente. Los logs de la ejecución y
el estado definitivo del despliegue se comunican en el informe final; este documento no acredita por sí solo producción.

Las pruebas runtime usan workerd y SQLite DO reales con transporte GitHub interceptado. Navegador: Chromium, contextos
independientes con emulación Pixel/iPhone y escritorio; no dispositivos físicos ni Safari. Performance: banco sintético,
no latencia de producción. Fixtures sintéticos en memoria; sin altas ni borrados remotos de usuarios de prueba.

Se conservan UUID, orden y algoritmo circular, CAS, límites de tamaño, pendientes y sesiones protegidas. No se cambian
dominio del generador, autenticación ni permisos.

## Límites PDF

Consultar PDF_UNICODE.md. Solo Barlow; caracteres no soportados impiden exportar con un mensaje explícito y sin
modificar datos. Se eliminan los 11,25 MB adicionales. La verificación anterior corresponde a la implementación
ampliada; la simplificación requiere repetir las suites antes de publicar.

## Publicación y producción

El workflow ejecuta las suites y publica Worker y assets del mismo commit si main sigue en ese SHA y
CLOUDFLARE_DEPLOY_ENABLED=true. Verificar el paso efectivo de deploy, versión Cloudflare y hashes de HTML, service
worker y fuentes remotas frente a dist; efectuar login QA y lectura autorizada sin modificar usuarios reales. No tratar
un job verde con deploy omitido como publicación.

## Verificación del alcance simplificado

16/10/2026: 105/105 pruebas unitarias, typecheck, build, check:worker, test:runtime, test:browser y test:performance
correctos. Extracción con pdftotext de español, puntuación y enlaces; finales de descripción y comentario de 100.000
caracteres conservados. Primera exportación offline correcta en Chromium. Caracteres CJK/cirílicos/emoji rechazados
explícitamente por pruebas unitarias sin alterar snapshots. Chromium local recuperado del archivo comprimido y ejecutado
sin GPU; no acredita Safari/iOS físico. Sin modificaciones remotas de datos de negocio durante las suites.

Publicación consolidada sobre 83d3377 para no incorporar al historial remoto los binarios retirados; los commits locales
originales se conservan.
