# Tests

Aplicación web **estática** (HTML + CSS + JavaScript, sin frameworks ni build) para hacer tests tipo examen.
Importas un "stack" de preguntas en formato JSON, lo guardas en el navegador, lo respondes con
corrección inmediata, repasas automáticamente las que fallas y consultas tus estadísticas e historial.

Pensada para alojarse tal cual en **GitHub Pages**. Todo se guarda en `localStorage` del navegador
(no hay servidor ni cuenta).

## Qué hace

- **Importar** stacks pegando el JSON o subiendo un archivo `.json`.
- **Guardar** varios stacks; listarlos, ver su detalle, exportarlos o borrarlos.
- Al responder, marca **al instante** si la opción es correcta (verde) o incorrecta (rojo) y muestra la explicación.
- Al terminar, **repite las preguntas falladas** en rondas de repaso hasta que las aciertas todas.
- **Estadísticas**: % de acierto a la primera, aciertos/fallos, tiempo, rondas y desglose por categoría.
- **Historial** de intentos por stack (con el mejor resultado).

> El **porcentaje** se mide solo con el **primer intento** de cada pregunta. El repaso sirve para aprender, no para inflar la nota.

## Cómo usarla

1. Abre la página (en GitHub Pages, o localmente abriendo `index.html`).
2. Pulsa **+ Importar stack** y pega el JSON (o sube un `.json`). Puedes probar con `ejemplo.json`.
3. Pulsa **Comenzar** y responde. Al final verás los resultados; desde ahí puedes **Repetir test**.

## Desplegar en GitHub Pages

1. Crea un repositorio en GitHub y sube estos archivos (`index.html`, `style.css`, `app.js`, `.nojekyll`, y opcionalmente `ejemplo.json` y este `README.md`) a la raíz.
   ```bash
   git init
   git add .
   git commit -m "App de tests"
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/TU_REPO.git
   git push -u origin main
   ```
2. En GitHub: **Settings → Pages**. En *Source* elige **Deploy from a branch**, rama `main` y carpeta `/ (root)`. Guarda.
3. En 1–2 minutos estará en `https://TU_USUARIO.github.io/TU_REPO/`.

El archivo `.nojekyll` evita que GitHub procese el sitio con Jekyll. No hace falta nada más.

## Formato de un stack (lo que genera la IA)

Un stack es un único objeto JSON:

```json
{
  "format": "tests-stack",
  "version": 1,
  "title": "Título del test",
  "description": "Descripción breve (opcional).",
  "questions": [
    {
      "text": "Enunciado de la pregunta",
      "category": "categoria-opcional",
      "options": [
        { "text": "Opción incorrecta", "correct": false },
        { "text": "Opción correcta", "correct": true }
      ],
      "explanation": "Por qué la respuesta correcta lo es (opcional)."
    }
  ]
}
```

Reglas clave:

- `format` debe ser `"tests-stack"` y `version` el número `1`.
- La respuesta correcta se indica **dentro de cada opción** con `"correct": true`. **No** se usan índices ni letras.
- **Una** respuesta correcta → selección única (corrección al pulsar).
  **Varias** opciones con `"correct": true` → varias respuestas (checkboxes + botón *Comprobar*; hay que acertar el conjunto exacto).
  **Verdadero/Falso** → dos opciones `"Verdadero"` y `"Falso"`, una con `"correct": true`.
- `category` y `explanation` son opcionales. El campo `id` se genera solo: **no** lo pongas.
- La importación es tolerante: si una pregunta está mal, se descarta esa y se importan las demás, avisándote.

## Prompt listo para pedirle los tests a otra IA

Copia esto en otro chat de IA y rellena el tema y el número de preguntas:

```
Necesito que generes un "stack" de preguntas tipo test en formato JSON. Sigue EXACTAMENTE estas
reglas y devuelve ÚNICAMENTE el JSON, sin texto antes ni después, sin bloques de código markdown
y sin comentarios.

TEMA: [ESCRIBE AQUÍ EL TEMA, p.ej. "Historia de Roma: república y primeros emperadores"]
NÚMERO DE PREGUNTAS: [ESCRIBE AQUÍ, p.ej. 20]
IDIOMA: español

ESTRUCTURA OBLIGATORIA (copia esta forma EXACTA):
{
  "format": "tests-stack",
  "version": 1,
  "title": "Título corto del tema",
  "description": "Una frase describiendo el stack.",
  "questions": [
    {
      "text": "¿Enunciado de la pregunta?",
      "category": "categoria-corta",
      "options": [
        { "text": "Opción A", "correct": false },
        { "text": "Opción B", "correct": true },
        { "text": "Opción C", "correct": false },
        { "text": "Opción D", "correct": false }
      ],
      "explanation": "Breve explicación de por qué la respuesta correcta lo es."
    }
  ]
}

REGLAS ESTRICTAS (cúmplelas TODAS):
1. "format" debe ser literalmente "tests-stack" y "version" debe ser el número 1 (sin comillas).
2. La respuesta correcta se indica SOLO con "correct": true dentro de la propia opción. NO uses
   índices, ni letras (A, B, C), ni un campo "answer" aparte. NUNCA escribas cuál es la correcta
   fuera de la opción. Esto es lo más importante: así nunca te equivocas contando.
3. En cada pregunta debe haber AL MENOS una opción con "correct": true:
   - Una sola respuesta: EXACTAMENTE una opción con "correct": true; las demás false.
   - Varias respuestas: DOS O MÁS opciones con "correct": true; además añade " (varias respuestas)"
     al final del enunciado.
   - Verdadero/Falso: usa exactamente dos opciones con "text": "Verdadero" y "text": "Falso", una
     con "correct": true.
4. "correct" es SIEMPRE un booleano sin comillas: true o false. Nunca "true" entre comillas, nunca
   1/0, nunca sí/no.
5. Cada pregunta tiene entre 2 y 5 opciones (texto plano, sin HTML).
6. "category" es un string corto en minúsculas que agrupa la pregunta por tema para las estadísticas
   (p.ej. "protocolos"). Si no aplica, pon "".
7. "explanation" es opcional pero recomendable: una sola frase clara.
8. NO incluyas el campo "id" ni ningún otro campo fuera de la estructura: se generan automáticamente.
9. Reglas de JSON que DEBES respetar para que sea válido:
   - Comillas dobles en TODAS las claves y strings; nunca comillas simples.
   - NO pongas coma después del último elemento de un array u objeto (nada de comas finales).
   - Escapa las comillas dobles dentro de un texto como \" y las barras invertidas como \\.
   - No uses saltos de línea reales dentro de un string; usa una sola frase.
10. Varía el tema entre preguntas, evita repetir enunciados y mezcla el orden para que la opción
    correcta no caiga siempre en la misma posición. Reparte las preguntas en 2-3 categorías y mezcla
    los tres tipos (una respuesta, varias respuestas y verdadero/falso).

Antes de responder, revisa mentalmente que el JSON parsea sin errores y que cada pregunta tiene al
menos un "correct": true. Devuelve solo el JSON válido.
```

## Privacidad

No hay servidor: los stacks y el historial viven solo en el `localStorage` de tu navegador.
Si borras los datos del navegador o usas otro dispositivo, no estarán. Usa **Exportar** para guardar
un stack como `.json` y reimportarlo donde quieras.
