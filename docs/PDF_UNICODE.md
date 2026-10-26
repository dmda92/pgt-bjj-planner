# Caracteres del PDF — alcance aprobado el 16/10/2026

Se conserva únicamente Barlow Regular/SemiBold, ya incluida localmente. Admite español (tildes, ñ, ü, ¿, ¡), puntuación
tipográfica habitual y enlaces. La tabla pdf-font-coverage.json es la intersección de los cmap de ambas fuentes locales.

Antes de generar se comprueban correo, posiciones, tipos, descripciones y comentarios. Los caracteres no cubiertos
producen un error explícito con su código Unicode; no se descarga un PDF incompleto ni se modifican los datos. No se
exige soporte CJK, cirílico ni emoji. Los saltos de línea se permiten.

Se retiran los 11,25 MB de fuentes adicionales, los alias BMP, ActualText y el generador de fuentes. La PWA conserva el
precaché de Barlow para exportar offline. npm/CI no requieren fuentes nuevas ni Python. Mantener pruebas de extracción
de español, puntuación y enlaces, continuidad de textos largos y rechazo explícito de caracteres no soportados.
