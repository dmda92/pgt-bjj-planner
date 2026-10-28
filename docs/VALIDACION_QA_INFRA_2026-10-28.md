# Conservacion de infraestructura QA local en develop

Encargo del propietario: integrar los cambios locales pendientes sin perderlos.
Feature aislada desde main 1481bb7; PR exclusivamente a develop. Ningun cambio de
aplicacion, dominio, configuracion de despliegue o secretos PRO.

Se conservan los suplementos de criterios, accesibilidad, seguridad, borradores y
revision visual PDF, selectores y fixtures de fallos, comparaciones de planes,
herramientas DOCX e indice navegable, y reportes separados por intento. AGENTS.md
conserva tanto las decisiones QA del propietario como los antecedentes PRO vigentes.

La plantilla oficial privada qa/fixtures/official-template.json permanece local:
excluida de Git mediante .gitignore y exclusion local del checkout original. Una copia
limpia debe recibirla por canal privado. No se suben .qa, credenciales, perfiles,
resultados, trazas, capturas, paquetes privados ni documentos de campana. Los cambios
originales del usuario no se sobrescriben ni se descartan.

## Validacion local

- Sintaxis correcta de 57 archivos QA JavaScript/Python.
- Playwright --list con manifiesto aislado: 241 pruebas recogidas, cubriendo los
  206 identificadores del protocolo, sin casos ausentes. No es ejecucion E2E.
- Seis pruebas Python de documentos/saneado correctas, incluidas las dos que leen
  el DOCX privado original. Original verificado por SHA; salida solo temporal.
- Bateria unitaria: 397 casos, 396 correctos, cero fallidos, un inspector opcional
  omitido (su ejecucion separada queda en CI de produccion previo).
- Typecheck, build, check:worker y cuatro suites test:runtime correctos.
- Escaneo de secretos: dos coincidencias eran cadenas para detectar cabeceras PEM,
  no claves incrustadas. Ninguna credencial real identificada en estos archivos.
- Ninguna campana nueva ejecutada; ninguna consulta ni escritura de QA a DEV/PRO.

El merge autorizado puede activar el workflow habitual DEV, con pruebas aisladas;
no autoriza publicar estos cambios en main ni iniciar otra campana remota.
