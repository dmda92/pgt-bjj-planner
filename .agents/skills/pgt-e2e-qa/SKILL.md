---
name: pgt-e2e-qa
description: Ejecutar campañas QA E2E de PGT BJJ Planner desde un protocolo DOCX con Playwright Test, evidencias por caso, resultados nuevos y reanudación.
---

# Campañas QA E2E de PGT

Usar la infraestructura `qa/playwright/` y `qa/tools/`. Leer AGENTS.md y el código
vigente antes de adaptar protocolos históricos. No corregir aplicación ni desplegar
durante QA salvo encargo posterior explícito. DEV es
`https://pgt-github-probe-dev.david-dzm5.workers.dev`; nunca ejecutar contra PRO.

## Entrada y campaña

Extraer del DOCX todos los identificadores, bloques, pasos y criterios. Crear una
campaña nueva en `.qa/campaigns/<id>/`, conservar el original, reiniciar cada estado
a NO EJECUTADO y no importar resultados ni aprobaciones anteriores. El número de
casos procede del documento, nunca de una constante. Revisar cualquier caso que el
extractor no reconozca antes de ejecutar. Guardar hash del documento y build DEV.

El entrenador QA es `tqa@tqa.com`. Leer la contraseña de
`.qa/credentials.local.json` (ignorado por Git), sin imprimirla. Autenticar mediante
el formulario. Crear A/B nuevos desde Registro, con correos únicos de campaña;
registrar correos/roles, nunca contraseñas, en resultados. Guardar nuevas credenciales
solo en configuración privada para reanudar. T/A/B usan browser contexts o perfiles
persistentes independientes; pestañas del mismo perfil no sustituyen ese aislamiento.

## Ejecución y seguridad de datos

Ejecutar cada caso con Playwright Test y comprobaciones explícitas de todos sus
criterios; un test sin excepciones no demuestra aprobación. Preparar precondiciones
por caso y datos aislados por grupo. Coordinar carreras intencionales; no paralelizar
modificaciones de los mismos usuarios/planes. Reutilizar sesiones cuando proceda y
destruirlas o cambiar identidad cuando lo exija la prueba.

Usar únicamente usuarios/competiciones de campaña. El roster y catálogo DEV son
compartidos: no modificar cuentas o planes ajenos. **Training Day puede emitir prepare
automáticamente para planes pendientes**: bloquear ese comando en remoto salvo planId
creado por la campaña. No provocar fallos cambiando reglas, secretos o configuración.
Inyectar errores mediante rutas Playwright o entorno local sintético del Worker.

Adaptar JSON remoto a agregados/planes Firestore, SHA a versión opaca y sincronización
a tiempo real vigente. Conservar ID original. Marcar NO APLICA solo mecanismos sin
equivalente funcional y justificarlo. Diferenciar DEV real, HTTP interceptado, Worker
local sintético y pruebas puras; una simulación no demuestra integración Google.

En casos críticos guardar estado inicial/final, respuesta, UUID, orden, versiones,
clientes receptores y ausencia de cambios ajenos. Comparar profundamente histórico y
planes protegidos, no contadores. Snapshots autorizados servidos por backend pueden
estar en caché; no presentarlos como lectura independiente directa de Firestore.
Si existe identidad read-only autorizada, usarla sin exportar secretos ni aumentar IAM.

## Evidencias y reanudación

Cada ID tiene resultado JSON y evidencias propios bajo la campaña. Registrar entorno,
hora, sesiones, pasos efectivamente ejecutados, observación, esperado, incidencias y
limitaciones. Conservar intentos fallidos y versiones anteriores del resultado.
Los filtros permiten bloque/caso/fallidos/pendientes; no reiniciar ya completados sin
motivo. Si cambia el build, registrar nueva ejecución y no mezclar conclusiones.

No grabar autenticación ni contraseñas en trazas. Las trazas Playwright pueden incluir
Authorization, tickets y respuestas de login: sanearlas antes de compartir. Logs de
red guardan método/ruta/status, nunca cabeceras de sesión o cuerpos de credenciales.
Mantener perfiles, secretos y artefactos crudos dentro de `.qa/`, ignorada por Git.

## Cierre

Actualizar una copia DOCX conservando estructura, IDs y criterios; solo resultados
comprobados. Generar HTML Playwright, resumen Markdown, inventario de incidencias,
evidencias por ID y checkpoint reanudable. Contabilizar los seis estados y separar
ejecución completa de aprobación. Revisar el DOCX renderizado con herramientas
disponibles; documentar límites reales. No declarar APROBADO con criterios sin probar.
Limpiar solo datos temporales de campaña cuando proceda; no hay borrado de cuentas
genérico por API. Informar usuarios conservados y tareas manuales concretas.
