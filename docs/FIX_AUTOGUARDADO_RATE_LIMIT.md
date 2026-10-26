# Autoguardado DEV y RATE_LIMIT — 26/10/2026

Incidencia del propietario: editar técnicas muestra RATE_LIMIT y requiere pulsar
Reintentar guardado. Reproducción en Worker real con transporte sintético: diez
guardados correctos, el undécimo HTTP 429 con Retry-After=60; cero lecturas y
escrituras de negocio para la petición rechazada. No era cuota Firestore agotada.

## Corrección

- Ventanas DEV por sesión de comandos: 60/minuto y 600/hora, frente a 10/100.
  Se mantienen límites finitos, controles de permisos y límites de login/tickets.
- Debounce del editor 1200 ms frente a 700 ms: agrupa más pulsaciones antes de
  escribir. No añade sondeos ni consultas. Los cambios en vuelo siguen serializados.
- El cliente reconoce únicamente 429 RATE_LIMIT de comandos con Retry-After
  numérico válido (1–3600 s), y muestra un mensaje comprensible.
- Solo una espera <=60 s permite un reintento automático del borrador más reciente,
  conservando su revisión base. El rechazo del servidor ocurre antes de mutar.
  Un segundo rechazo o una espera larga requiere reintento manual; pulsarlo antes
  del plazo no vuelve a enviar. Conflictos/transporte conservan revisión manual.
- Un cambio de sesión o cualquier paso offline, aunque reconecte antes del plazo,
  invalida el reintento automático. No se crea una cola offline. Logout/descartar
  cancelan el temporizador y se mantiene la política de borradores volátiles.

## Validación y límites

Pruebas de reloj simulado: espera exacta, coalescencia y base original, un solo
reintento, segundo 429, límite horario, offline/reconexión, descarte y reintento
manual posterior. Runtime aislado acepta 60 cambios y rechaza el 61 sin IO de
negocio. Chromium intercepta un 429, recupera con dos intentos totales y verifica
texto en el segundo dispositivo; conserva concurrencia/CAS, PDF offline e inactividad.
Capturas de escritorio/móvil revisadas; sin cambio de diseño.

Typecheck, build, check:worker, test:runtime y test:browser correctos. Batería
completa local: 331/331 en la ejecución previa a la última prueba de reconexión;
suite final de editor: 8/8. CI valida de nuevo el conjunto final (332 pruebas).
Sin pruebas de carga contra Google ni cambios en datos importados o GitHub PRO.
No equivale a medir cuota real ni aceptación Safari/iOS. La protección por frecuencia
limita peticiones, no garantiza un presupuesto global de documentos Firestore.

Archivos: worker/v2/runtime.ts, src/application/{online-draft,firestore-client,
save-throttled}.ts, enlace del editor en src/main.tsx y sus pruebas.
Integración autorizada por PR de la feature existente a develop; main/PRO intactos.
