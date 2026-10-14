# Identidad visual PGT BJJ Planner

## Dirección

PGT es una herramienta de trabajo del equipo de competición de Portugal Gold Team. La identidad se apoya en su logo: superficies blancas, verde de equipo y un acento dorado. El elemento característico es la cabecera verde con un borde dorado que recuerda la franja de un cinturón; el resto mantiene una composición tranquila y funcional. No añadir gráficos de actividad ficticia, fotos decorativas de luchadores ni métricas que no estén disponibles.

La dirección se presentó al propietario antes de modificar el frontend. Se revisó frente al encargo: un kit de tarjetas idénticas con gradientes y una cabecera publicitaria no ayuda a gestionar alumnos. El dashboard utiliza una lista de equipo junto a una ficha de trabajo, y separa las competiciones de esa consulta. No es una landing page.

## Skill de referencia

Se incorporan las instrucciones originales de Anthropic en [.agents/skills/frontend-design/SKILL.md](../.agents/skills/frontend-design/SKILL.md) y su `LICENSE.txt`, sin alterarlas. Fuente: https://github.com/anthropics/skills/tree/main/skills/frontend-design; versión leída el 14/10/2026, blob GitHub `a5333457c414d20d625f307df945842c0952ecc3`. La integración es local y explícita mediante AGENTS.md; no supone instalar un plugin global ni cambiar el catálogo de skills de ChatGPT Work. Aplicar sus principios junto a los requisitos iniciales y las restricciones de PGT. Las instrucciones del propietario prevalecen.

## Tokens

| Token          | Valor     | Uso                                             |
| -------------- | --------- | ----------------------------------------------- |
| Tinta          | `#182c24` | Texto y controles                               |
| Verde          | `#176344` | Acción principal y progreso                     |
| Verde profundo | `#123f30` | Cabecera y sección seleccionada                 |
| Dorado         | `#f1c232` | Franja de equipo y sincronización; texto oscuro |
| Fondo          | `#f1f4f2` | Área de trabajo                                 |
| Blanco         | `#ffffff` | Formularios y superficies de lectura            |

Los tokens auxiliares de líneas, estados, texto secundario y foco están en `src/app.css`. Rojo se reserva para acciones destructivas; ámbar para advertencias. Los estados incluyen texto o símbolos y no se comunican solo con color. Dorado no se usa como texto pequeño sobre blanco. Mantener contraste WCAG AA del texto y foco claramente visible.

**Tipografía:** Barlow regular para lectura y formularios; Barlow semibold para controles; Barlow Condensed semibold para títulos y cifras del resumen. Escala aproximada: 12–14 px para metadatos, 16 px para cuerpo, 26–32 px para secciones y 36–52 px para cabecera. No añadir etiquetas en mayúsculas ni espaciado de letras ornamental. Números de resumen tabulares. Texto alineado a la izquierda, con líneas de lectura menores de unas 80 posiciones cuando el contenido lo permite.

Las tres fuentes TTF se distribuyen en `public/fonts/`, con licencias SIL OFL de Google Fonts (repositorio `google/fonts`, carpetas `ofl/barlow` y `ofl/barlowcondensed`). No utilizar CDN, Google Fonts remoto ni nuevas dependencias de ejecución. El build las añade al precache existente del service worker; se conservan offline.

## Composición

- Escritorio: cabecera de identidad y sesión; navegación lateral; área de trabajo amplia. El dashboard contiene resumen, lista de usuarios y ficha seleccionada, seguida de formulario de competición y catálogo. Las personas registradas conservan su rol visible, también cuando la lista incluye entrenadores.
- Resumen: alumnos con rol alumno, competiciones del catálogo y número total de asignaciones (sumatorio de alumnos de cada competición, no personas únicas). Son cálculos de las respuestas autorizadas existentes. Mientras no está cargado el catálogo se muestra una raya, nunca un cero inventado ni una tendencia.
- Ficha: identidad, técnicas descritas/total y progreso real; búsqueda, roles, comentarios, contraseñas y planes siguen usando sus acciones originales. No confundir el porcentaje de una ficha con una media global del equipo.
- Las competiciones conservan sus fechas, configuración fija, casillas de asignación y confirmación de borrado. Se distinguen zonas, no nuevas reglas.
- Hasta 850 px la navegación pasa a una fila; a 640 px la ficha, lista y formularios pasan a una columna. El listado móvil tiene scroll propio cuando crece. Los correos largos se ajustan sin desbordar.
- Espaciados: 8–12 px entre elementos relacionados, 16–24 px dentro de zonas y 24–36 px entre áreas. Bordes redondeados de 4–8 px según función; evitar sombras repetidas.

## Interacción y accesibilidad

Hover modifica superficies, no desplaza tarjetas. Transiciones de color de 140 ms; no hay animaciones automáticas decorativas. `prefers-reduced-motion` elimina transiciones y animaciones. Botones con objetivo táctil de al menos 44 px de alto; etiquetas reales en formularios, iconos SVG decorativos ocultos a lectores y texto siempre visible. La sección activa usa `aria-current`; el alumno seleccionado usa `aria-pressed`; el progreso tiene nombre accesible. Hay enlace para saltar al contenido.

No ocultar errores, conflictos, estados de sincronización o cambios pendientes para limpiar el diseño. No alterar la caché privada ni el mecanismo de actualización. La estética se aplica a login, alumno, planes, perfil y entrenador, pero el contenido del PDF y el generador permanecen intactos.

## Límites y verificación futura

Cambios visuales permitidos en `src/main.tsx`, `src/app.css`, recursos públicos y metadatos de color de la PWA. Ningún endpoint nuevo ni cambios en permisos, modelos, algoritmos, hash, sincronización o arquitectura. No acceder a Cloudflare ni desplegar desde Work.

Ejecutar las verificaciones de AGENTS.md y `npm run test:browser`. Revisar login, repertorio, dashboard vacío/con ficha/con competición, planes y perfil. Comprobar anchuras 360, 390, 768, 1280 y 1440 px, foco, formularios largos, búsqueda sin resultados y movimiento reducido. Las capturas se generan en `.browser-artifacts/` (no versionadas). El navegador local usa datos sintéticos; no demuestra integración remota ni aceptación en iPhone/Safari. Registrar resultados de UI en `docs/VALIDACION_DISENO.md` y conservar la validación funcional histórica en `docs/VALIDACION.md`.
