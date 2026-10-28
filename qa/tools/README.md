# Herramientas de documentos y resultados de QA

Estas herramientas no ejecutan pruebas ni deducen aprobaciones. Usan Python 3 estándar para conservar el documento fuente y reconstruir resultados desde registros individuales.

```powershell
python qa/tools/protocol_docx.py extract --source "ruta/protocolo.docx" --campaign "identificador" --output ".qa/campaigns/identificador/manifest.json"
python qa/tools/campaign_report.py --campaign ".qa/campaigns/identificador"
python qa/tools/protocol_docx.py fill --manifest ".qa/campaigns/identificador/manifest.json" --results ".qa/campaigns/identificador/results" --output ".qa/campaigns/identificador/reports/resultados.docx"
python qa/tools/sanitize_artifacts.py --artifacts ".qa/campaigns/identificador/reports" ".qa/campaigns/identificador/evidence" --secret-file ".qa/credentials.local.json" --secret-file ".qa/campaigns/identificador/users.private.json"
python qa/tools/sanitize_artifacts.py --check --artifacts ".qa/campaigns/identificador/reports" ".qa/campaigns/identificador/evidence" --secret-file ".qa/credentials.local.json" --secret-file ".qa/campaigns/identificador/users.private.json"
node qa/tools/render_report_html.mjs ".qa/campaigns/identificador/reports/case-results.html" ".qa/campaigns/identificador/reports/content-review"
```

`protocol_docx.py` reconoce fichas con estilo Word Heading2 y título `BLOQUE 01 Objetivo`, y los campos `Prioridad`, `Pasos` y `Resultado esperado`. Los estados anteriores nunca se extraen. Para otra estructura hay que añadir un adaptador explícito y comprobar el número y los identificadores antes de ejecutar la campaña. No sustituir silenciosamente un protocolo no reconocido.

Si hay comentarios de Word, resolverlos o retirarlos de una copia de trabajo mediante la skill de documentos antes de extraer. El original permanece intacto; la herramienta rechaza comentarios para no heredar resultados antiguos ni dejar relaciones OOXML incompletas. El resto de las partes opacas del paquete se conserva.

Los registros se guardan en `results/BLOQUE-01.json`, con `id`, `status`, `executedAt`, `environment`, `users`, `steps`, `observed`, `expected`, `evidence`, `incident`, `limitation` y `adaptation`. Las evidencias son rutas relativas a la carpeta de campaña. Un resultado ausente se representa como NO EJECUTADO. `audit.json` detecta referencias inexistentes y aprobaciones sin pasos, observación o evidencia; esa auditoría no sustituye la revisión de los criterios.

El saneador conserva nombres de entradas ZIP de Playwright, redacta valores sensibles y nunca modifica carpetas de perfiles ni archivos privados de credenciales. Ejecutarlo antes de compartir trazas o informes. Las capturas requieren revisión visual propia: la redacción de texto no oculta píxeles de una contraseña que se haya fotografiado visible.

La ejecución completa solo cuenta APROBADO y FALLIDO. PARCIAL, BLOQUEADO y NO APLICA no se suman a APROBADO. El porcentaje de aprobación utiliza como denominador los casos ejecutados completamente.

Para DOCX, usar la skill de documentos y su renderizador canónico con el runtime y LibreOffice empaquetados. No usar el LibreOffice de escritorio del usuario. El render HTML es una alternativa de revisión de contenido cuando ese runtime falta; no acredita paginación ni fidelidad visual de Word. Dejar constancia de la limitación y no afirmar que el DOCX se ha validado visualmente.

En Windows se ha preparado un motor privado de QA, extraído administrativamente de un MSI oficial con SHA-256 y firma de The Document Foundation comprobados. No es una instalación de escritorio. Se reutiliza con `qa/tools/prepare-docx-renderer.ps1`; el script descarga solo desde el dominio oficial si falta el paquete y rechaza paquetes no verificados. Las dependencias Python locales se sitúan en `.qa/python-deps`, fuera de Git.

```powershell
./qa/tools/prepare-docx-renderer.ps1
python -m pip install --target .qa/python-deps -r qa/tools/requirements-render.txt
$env:PYTHONPATH = "$PWD/.qa/python-deps"
python qa/tools/render_docx_qa.py ".qa/campaigns/identificador/reports/resultados.docx" --output ".qa/campaigns/identificador/reports/document-render" --soffice "$PWD/.qa/tools/lo-extracted/program/soffice.exe" --skill-renderer "ruta/skill/documents/render_docx.py"
```

El wrapper usa el convertidor canónico de la skill y un perfil temporal propio. Solo sustituye Poppler por PyMuPDF para rasterizar el PDF que produce Writer; registra el ejecutable absoluto y todas las páginas en `render-audit.json`. Las imágenes y el PDF intermedio sirven para revisión interna, no sustituyen el entregable DOCX.
