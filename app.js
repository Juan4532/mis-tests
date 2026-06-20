'use strict';

/* =========================================================================
   Tests — app de tests 100% estática (HTML + CSS + JS vanilla).
   Sin dependencias, sin build, sin servidor. Persistencia en localStorage.
   Pensada para alojarse tal cual en GitHub Pages.
   ========================================================================= */

/* ---------- Constantes ---------- */
const PREFIX = 'tests:';
const KEY_STACKS = PREFIX + 'stacks';     // { [id]: stack }
const KEY_HISTORY = PREFIX + 'history';   // { [stackId]: [attempt, ...] }
const KEY_META = PREFIX + 'meta';         // { schemaVersion }
const FORMAT_ID = 'tests-stack';
const MAX_VERSION = 1;     // versión máxima del formato que entendemos
const MAX_ROUNDS = 10;     // tope de seguridad de rondas de repaso
const SCHEMA_VERSION = 1;  // versión de la estructura interna de almacenamiento
const CATALOG_DIR = 'tests/';                       // carpeta del repo con stacks listos
const CATALOG_MANIFEST = CATALOG_DIR + 'manifest.json';

/* Prompt listo para pegar en otro chat de IA y que genere un stack en el formato correcto. */
const AI_PROMPT = `Necesito que generes un "stack" de preguntas tipo test en formato JSON. Sigue EXACTAMENTE estas reglas y devuelve ÚNICAMENTE el JSON, sin texto antes ni después, sin bloques de código markdown y sin comentarios.

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
2. La respuesta correcta se indica SOLO con "correct": true dentro de la propia opción. NO uses índices, ni letras (A, B, C), ni un campo "answer" aparte. NUNCA escribas cuál es la correcta fuera de la opción. Esto es lo más importante: así nunca te equivocas contando.
3. En cada pregunta debe haber AL MENOS una opción con "correct": true:
   - Una sola respuesta: EXACTAMENTE una opción con "correct": true; las demás false.
   - Varias respuestas: DOS O MÁS opciones con "correct": true; además añade " (varias respuestas)" al final del enunciado.
   - Verdadero/Falso: usa exactamente dos opciones con "text": "Verdadero" y "text": "Falso", una con "correct": true.
4. "correct" es SIEMPRE un booleano sin comillas: true o false. Nunca "true" entre comillas, nunca 1/0, nunca sí/no.
5. Cada pregunta tiene entre 2 y 5 opciones (texto plano, sin HTML).
6. "category" es un string corto en minúsculas que agrupa la pregunta por tema para las estadísticas (p.ej. "protocolos"). Si no aplica, pon "".
7. "explanation" es opcional pero recomendable: una sola frase clara.
8. NO incluyas el campo "id" ni ningún otro campo fuera de la estructura: se generan automáticamente.
9. Reglas de JSON que DEBES respetar para que sea válido:
   - Comillas dobles en TODAS las claves y strings; nunca comillas simples.
   - NO pongas coma después del último elemento de un array u objeto (nada de comas finales).
   - Escapa las comillas dobles dentro de un texto como \\" y las barras invertidas como \\\\.
   - No uses saltos de línea reales dentro de un string; usa una sola frase.
10. Varía el tema entre preguntas, evita repetir enunciados y mezcla el orden para que la opción correcta no caiga siempre en la misma posición. Reparte las preguntas en 2-3 categorías y mezcla los tres tipos (una respuesta, varias respuestas y verdadero/falso).

Antes de responder, revisa mentalmente que el JSON parsea sin errores y que cada pregunta tiene al menos un "correct": true. Devuelve solo el JSON válido.`;

const app = document.getElementById('app');

/* ---------- Utilidades ---------- */
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function slugify(s) {
  const out = String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return out || 'stack';
}

function genStackId(title) {
  return slugify(title) + '-' + Math.random().toString(36).slice(2, 8);
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

function formatDuration(seconds) {
  seconds = Math.max(0, Math.round(seconds));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m === 0 ? s + 's' : m + 'm ' + s + 's';
}

function formatDateTime(ms) {
  try {
    return new Date(ms).toLocaleString('es-ES', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  } catch (e) { return ''; }
}

function pctClass(p) { return p >= 80 ? 'good' : (p >= 50 ? 'mid' : 'bad'); }

/* ---------- Persistencia (localStorage, tolerante a fallos) ---------- */
function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const val = JSON.parse(raw);
    return (val == null) ? fallback : val;
  } catch (e) {
    console.warn('Clave corrupta, se reinicia:', key, e);
    try { localStorage.removeItem(key); } catch (_) {}
    return fallback;
  }
}

function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.error('No se pudo guardar', key, e);
    const quota = e && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014);
    alert(quota
      ? 'No hay espacio en el almacenamiento del navegador. Borra algún stack o vacía historiales e inténtalo de nuevo. Puedes exportar tus stacks a .json antes de borrar.'
      : 'No se pudo guardar en este navegador (¿modo privado?). Los cambios podrían no conservarse.');
    return false;
  }
}

function getStacks() { return loadJSON(KEY_STACKS, {}); }
function setStacks(s) { return saveJSON(KEY_STACKS, s); }
function getHistory() { return loadJSON(KEY_HISTORY, {}); }
function setHistory(h) { return saveJSON(KEY_HISTORY, h); }

(function initMeta() {
  const meta = loadJSON(KEY_META, null);
  if (!meta || meta.schemaVersion !== SCHEMA_VERSION) {
    saveJSON(KEY_META, { schemaVersion: SCHEMA_VERSION });
  }
})();

/* ---------- Importación y validación tolerante ---------- */
// Devuelve { ok:true, stack, warnings } ó { ok:false, error, warnings }
function parseAndValidate(rawText) {
  let obj;
  try {
    obj = JSON.parse(rawText);
  } catch (e) {
    return { ok: false, error: 'El texto no es JSON válido: ' + e.message, warnings: [] };
  }
  return validateStack(obj);
}

function validateStack(obj) {
  const warnings = [];
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, error: 'El contenido no es un objeto JSON válido.', warnings };
  }
  if (obj.format !== FORMAT_ID) {
    return { ok: false, error: 'Este archivo no parece un stack de Tests (debe tener "format": "tests-stack").', warnings };
  }
  let version = obj.version;
  if (typeof version !== 'number' || !Number.isFinite(version)) {
    warnings.push('Falta "version" o no es un número; se asume la versión 1.');
    version = 1;
  }
  if (version > MAX_VERSION) {
    warnings.push('El stack se creó con una versión más nueva (' + version + '); se intenta importar igualmente.');
  }
  let title = (typeof obj.title === 'string') ? obj.title.trim() : '';
  if (!title) { title = 'Test sin título'; warnings.push('El stack no tenía título; se usó "Test sin título".'); }
  const description = (typeof obj.description === 'string') ? obj.description.trim() : '';

  if (!Array.isArray(obj.questions) || obj.questions.length === 0) {
    return { ok: false, error: 'El stack no contiene preguntas.', warnings };
  }

  const questions = [];
  obj.questions.forEach((q, i) => {
    const n = i + 1;
    if (!q || typeof q !== 'object' || Array.isArray(q)) {
      warnings.push('Pregunta ' + n + ' descartada: no es un objeto.');
      return;
    }
    const text = (typeof q.text === 'string') ? q.text.trim() : '';
    if (!text) { warnings.push('Pregunta ' + n + ' descartada: enunciado vacío.'); return; }
    if (!Array.isArray(q.options) || q.options.length < 2) {
      warnings.push('Pregunta ' + n + ' descartada: necesita al menos 2 opciones.'); return;
    }
    if (q.options.length > 8) {
      warnings.push('Pregunta ' + n + ': tenía más de 8 opciones; se usaron las primeras 8.');
    }

    const opts = [];
    let badOpt = false;
    let nonBoolWarned = false;
    q.options.slice(0, 8).forEach((o) => {
      if (!o || typeof o !== 'object' || Array.isArray(o)) { badOpt = true; return; }
      const otext = (typeof o.text === 'string') ? o.text.trim() : '';
      if (!otext) { badOpt = true; return; }
      if (o.correct !== true && o.correct !== false && o.correct !== undefined && !nonBoolWarned) {
        warnings.push('Pregunta ' + n + ': algún "correct" no es booleano; se trató como false.');
        nonBoolWarned = true;
      }
      opts.push({ text: otext, correct: o.correct === true });
    });

    if (badOpt || opts.length < 2) {
      warnings.push('Pregunta ' + n + ' descartada: opciones inválidas (texto vacío o no son objetos).'); return;
    }
    if (opts.filter(o => o.correct).length === 0) {
      warnings.push('Pregunta ' + n + ' descartada: ninguna opción marcada como correcta ("correct": true).'); return;
    }

    const seen = new Set();
    let dupWarned = false;
    opts.forEach(o => {
      if (seen.has(o.text) && !dupWarned) { warnings.push('Pregunta ' + n + ': hay opciones con texto duplicado.'); dupWarned = true; }
      seen.add(o.text);
    });

    questions.push({
      id: 'q' + (questions.length + 1),
      text: text,
      category: (typeof q.category === 'string') ? q.category.trim() : '',
      explanation: (typeof q.explanation === 'string') ? q.explanation.trim() : '',
      options: opts
    });
  });

  if (questions.length === 0) {
    return { ok: false, error: 'Ninguna pregunta era válida. Revisa el formato.', warnings };
  }

  const stack = {
    id: genStackId(title),
    format: FORMAT_ID,
    version: version,
    title: title,
    description: description,
    questions: questions,
    importedAt: Date.now(),
    questionCount: questions.length
  };
  return { ok: true, stack: stack, warnings: warnings };
}

/* ---------- Catálogo (stacks de la carpeta tests/ del repo) ---------- */
// id estable por archivo: recargar actualiza en vez de duplicar, y conserva su historial.
function catalogId(file) { return 'cat-' + slugify(String(file).replace(/\.json$/i, '')); }

function fetchCatalogStack(file) {
  return fetch(CATALOG_DIR + encodeURIComponent(file), { cache: 'no-store' }).then(res => {
    if (!res.ok) throw new Error('No se pudo descargar (HTTP ' + res.status + ')');
    return res.text();
  }).then(text => {
    const parsed = parseAndValidate(text);
    if (!parsed.ok) throw new Error(parsed.error || 'Stack inválido.');
    parsed.stack.id = catalogId(file);
    parsed.stack.source = 'catalog';
    parsed.stack.file = file;
    return parsed.stack;
  });
}

function loadCatalogStack(file, then) {
  fetchCatalogStack(file).then(stack => {
    const stacks = getStacks();
    stacks[stack.id] = stack;
    if (!setStacks(stacks)) return;
    if (then === 'start') startQuiz(stack.id); else showHome('mis');
  }).catch(e => alert('No se pudo cargar del catálogo: ' + e.message));
}

// Rellena (async) la pestaña Catálogo. Si no hay manifest (p.ej. abierto con file://)
// muestra una nota: el resto de la app funciona igual con Importar stack.
const CATALOG_UNAVAILABLE = '<div class="empty">El catálogo no está disponible aquí. ' +
  'Se ve cuando la app está en la web (GitHub Pages) o servida con un servidor local. ' +
  'Si abriste el archivo directamente, usa <strong>+ Importar stack</strong>.</div>';

function renderCatalog() {
  const sec = document.getElementById('catalog-section');
  if (!sec) return;
  if (typeof fetch === 'undefined') { sec.innerHTML = CATALOG_UNAVAILABLE; return; }
  fetch(CATALOG_MANIFEST, { cache: 'no-store' })
    .then(r => (r.ok ? r.json() : null))
    .then(man => {
      if (!man || !Array.isArray(man.stacks) || man.stacks.length === 0) {
        sec.innerHTML = '<div class="empty">No hay tests en el catálogo todavía. ' +
          'Añade archivos <code>.json</code> a la carpeta <code>tests/</code> del repositorio.</div>';
        return;
      }
      const stacks = getStacks();
      let html = '<p class="muted modes-help">Tests incluidos en el repositorio (carpeta <code>tests/</code>). ' +
                 'Al cargar uno, pasa a <strong>Mis tests</strong> y guarda su propio historial.</p><div class="cards">';
      man.stacks.forEach(s => {
        const loaded = !!stacks[catalogId(s.file)];
        html += '<div class="card">' +
          '<h3>' + escapeHtml(s.title || s.file) + ' <span class="chip">catálogo</span></h3>' +
          (s.description ? '<p class="muted">' + escapeHtml(s.description) + '</p>' : '') +
          '<p class="meta">' + (s.count != null ? s.count : '?') + ' preguntas' + (loaded ? ' · ya cargado' : '') + '</p>' +
          '<div class="card-actions">' +
            (loaded
              ? '<button class="btn primary" data-cat-start="' + escapeHtml(s.file) + '" type="button">Comenzar</button>' +
                '<button class="btn" data-cat-load="' + escapeHtml(s.file) + '" type="button">Recargar</button>'
              : '<button class="btn primary" data-cat-load="' + escapeHtml(s.file) + '" type="button">Cargar</button>') +
          '</div></div>';
      });
      html += '</div>';
      sec.innerHTML = html;
      sec.querySelectorAll('[data-cat-load]').forEach(b => b.onclick = () => loadCatalogStack(b.getAttribute('data-cat-load'), 'home'));
      sec.querySelectorAll('[data-cat-start]').forEach(b => b.onclick = () => startQuiz(catalogId(b.getAttribute('data-cat-start'))));
    })
    .catch(() => { sec.innerHTML = CATALOG_UNAVAILABLE; });
}

/* ---------- Vista: Inicio (pestañas Mis tests / Catálogo) ---------- */
let homeTab = 'mis'; // 'mis' | 'catalogo' — se recuerda entre navegaciones

function showHome(tab) {
  session = null;
  if (tab === 'mis' || tab === 'catalogo') homeTab = tab;
  const stacks = getStacks();
  const history = getHistory();
  const ids = Object.keys(stacks).sort((a, b) => (stacks[b].importedAt || 0) - (stacks[a].importedAt || 0));
  const onMis = homeTab !== 'catalogo';

  let html = '<section class="view">';
  html += '<div class="view-head"><h2>Inicio</h2>' +
          '<button class="btn primary" id="btn-import" type="button">+ Importar stack</button></div>';
  html += '<div class="tabs" role="tablist">' +
    '<button class="tab' + (onMis ? ' active' : '') + '" id="tab-mis" type="button" role="tab">Mis tests' +
      (ids.length ? ' <span class="count">' + ids.length + '</span>' : '') + '</button>' +
    '<button class="tab' + (onMis ? '' : ' active') + '" id="tab-catalogo" type="button" role="tab">Catálogo</button>' +
  '</div>';

  if (onMis) {
    html += '<div class="tabpanel" id="panel-mis">';
    if (ids.length === 0) {
      html += '<div class="empty">Aún no has guardado ningún test aquí. Cárgalos desde el <strong>Catálogo</strong>, ' +
              'pulsa <strong>Importar stack</strong>, o prueba con <code>ejemplo.json</code>.</div>';
    } else {
      html += '<div class="cards">';
      ids.forEach(id => {
        const s = stacks[id];
        const attempts = history[id] || [];
        const best = attempts.reduce((m, a) => Math.max(m, a.pct || 0), 0);
        html += '<div class="card">' +
          '<h3>' + escapeHtml(s.title) + (s.source === 'catalog' ? ' <span class="chip">catálogo</span>' : '') + '</h3>' +
          (s.description ? '<p class="muted">' + escapeHtml(s.description) + '</p>' : '') +
          '<p class="meta">' + s.questionCount + ' preguntas · ' + attempts.length + ' intento(s)' +
            (attempts.length ? ' · mejor ' + best + '%' : '') + '</p>' +
          '<div class="card-actions">' +
            '<button class="btn primary" data-start="' + escapeHtml(id) + '" type="button">Comenzar</button>' +
            '<button class="btn" data-detail="' + escapeHtml(id) + '" type="button">Detalle</button>' +
            '<button class="btn ghost" data-export="' + escapeHtml(id) + '" type="button">Exportar</button>' +
            '<button class="btn danger" data-delete="' + escapeHtml(id) + '" type="button">Borrar</button>' +
          '</div></div>';
      });
      html += '</div>';
    }
    html += '</div>';
  } else {
    html += '<div class="tabpanel" id="panel-catalogo">' +
            '<div id="catalog-section"><p class="muted">Cargando catálogo…</p></div></div>';
  }
  html += '</section>';
  app.innerHTML = html;

  document.getElementById('btn-import').onclick = showImport;
  document.getElementById('tab-mis').onclick = () => showHome('mis');
  document.getElementById('tab-catalogo').onclick = () => showHome('catalogo');

  if (onMis) {
    app.querySelectorAll('[data-start]').forEach(b => b.onclick = () => startQuiz(b.getAttribute('data-start')));
    app.querySelectorAll('[data-detail]').forEach(b => b.onclick = () => showStackDetail(b.getAttribute('data-detail')));
    app.querySelectorAll('[data-export]').forEach(b => b.onclick = () => exportStack(b.getAttribute('data-export')));
    app.querySelectorAll('[data-delete]').forEach(b => b.onclick = () => deleteStack(b.getAttribute('data-delete')));
  } else {
    renderCatalog();
  }
}

/* ---------- Vista: Importar ---------- */
function showImport() {
  session = null;
  let html = '<section class="view">';
  html += '<div class="view-head"><h2>Importar stack</h2>' +
          '<button class="btn" id="btn-back" type="button">← Volver</button></div>';
  html += '<p class="muted">Pega el JSON que te generó la IA, o sube un archivo <code>.json</code>.</p>';

  // Bloque: indicaciones para la IA (prompt copiable)
  html += '<div class="ai-help">' +
    '<div class="ai-help-head">' +
      '<span><strong>¿No tienes el JSON todavía?</strong> Copia este prompt y pégalo en otro chat de IA ' +
      '(ChatGPT, Gemini, Claude…) con tu tema; te devolverá el test listo para pegar aquí.</span>' +
      '<button class="btn primary small" id="btn-copy-prompt" type="button">📋 Copiar prompt para la IA</button>' +
    '</div>' +
    '<details class="ai-prompt-details"><summary>Ver el prompt</summary>' +
      '<pre id="ai-prompt-text">' + escapeHtml(AI_PROMPT) + '</pre>' +
    '</details>' +
  '</div>';

  html += '<div class="import-box">' +
    '<label class="field"><span>Subir archivo .json</span>' +
      '<input type="file" id="file-input" accept=".json,application/json"></label>' +
    '<label class="field"><span>O pega el JSON aquí</span>' +
      '<textarea id="paste-area" rows="12" spellcheck="false" ' +
      'placeholder=\'{ "format": "tests-stack", "version": 1, "title": "...", "questions": [ ... ] }\'></textarea></label>' +
    '<button class="btn primary" id="btn-do-import" type="button">Importar</button>' +
    '<div id="import-result"></div>' +
  '</div></section>';
  app.innerHTML = html;

  document.getElementById('btn-back').onclick = showHome;
  document.getElementById('file-input').onchange = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { const ta = document.getElementById('paste-area'); if (ta) ta.value = String(reader.result || ''); };
    reader.onerror = () => showImportResult({ ok: false, error: 'No se pudo leer el archivo.', warnings: [] });
    reader.readAsText(file);
  };
  document.getElementById('btn-do-import').onclick = doImport;
  document.getElementById('btn-copy-prompt').onclick = copyAiPrompt;
}

function copyAiPrompt(e) {
  const btn = e && e.currentTarget;
  const done = (ok) => {
    if (!btn) return;
    const prev = btn.textContent;
    btn.textContent = ok ? '✓ Copiado' : 'Cópialo a mano ↓';
    if (!ok) { const d = document.querySelector('.ai-prompt-details'); if (d) d.open = true; }
    setTimeout(() => { btn.textContent = prev; }, 1800);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(AI_PROMPT).then(() => done(true), () => done(false));
  } else {
    // Fallback: seleccionar el texto del <pre> para copiarlo a mano.
    done(false);
  }
}

function doImport() {
  const text = document.getElementById('paste-area').value.trim();
  if (!text) { showImportResult({ ok: false, error: 'Pega el JSON o sube un archivo primero.', warnings: [] }); return; }
  const res = parseAndValidate(text);
  if (res.ok) {
    const stacks = getStacks();
    stacks[res.stack.id] = res.stack;
    if (!setStacks(stacks)) return; // el aviso ya se mostró
  }
  showImportResult(res);
}

function renderWarnings(warnings) {
  let html = '<div class="alert warn"><strong>Avisos (' + warnings.length + '):</strong><ul>';
  warnings.slice(0, 30).forEach(w => html += '<li>' + escapeHtml(w) + '</li>');
  if (warnings.length > 30) html += '<li>… y ' + (warnings.length - 30) + ' más.</li>';
  html += '</ul></div>';
  return html;
}

function showImportResult(res) {
  const box = document.getElementById('import-result');
  if (!box) return;
  let html = '';
  if (!res.ok) {
    html += '<div class="alert error">' + escapeHtml(res.error || 'No se pudo importar.') + '</div>';
    if (res.warnings && res.warnings.length) html += renderWarnings(res.warnings);
  } else {
    html += '<div class="alert success">Importado: <strong>' + escapeHtml(res.stack.title) + '</strong> con ' +
            res.stack.questionCount + ' pregunta(s).</div>';
    if (res.warnings && res.warnings.length) html += renderWarnings(res.warnings);
    html += '<div class="card-actions">' +
      '<button class="btn primary" id="ir-comenzar" type="button">Comenzar ahora</button>' +
      '<button class="btn" id="ir-home" type="button">Ir a mis tests</button></div>';
  }
  box.innerHTML = html;
  const c = document.getElementById('ir-comenzar');
  if (c) c.onclick = () => startQuiz(res.stack.id);
  const h = document.getElementById('ir-home');
  if (h) h.onclick = showHome;
}

/* ---------- Vista: Detalle del stack (con historial) ---------- */
function showStackDetail(id) {
  session = null;
  const stacks = getStacks();
  const s = stacks[id];
  if (!s) { showHome(); return; }
  const attempts = (getHistory()[id] || []).slice().sort((a, b) => (b.date || 0) - (a.date || 0));
  const best = attempts.reduce((m, a) => Math.max(m, a.pct || 0), 0);

  let html = '<section class="view">';
  html += '<div class="view-head"><h2>' + escapeHtml(s.title) + '</h2>' +
          '<button class="btn" id="btn-back" type="button">← Volver</button></div>';
  if (s.description) html += '<p class="muted">' + escapeHtml(s.description) + '</p>';
  html += '<p class="meta">' + s.questionCount + ' preguntas' +
          (attempts.length ? ' · ' + attempts.length + ' intento(s) · mejor ' + best + '%' : '') + '</p>';
  html += '<div class="card-actions">' +
    '<button class="btn primary" id="btn-practica" type="button">▶ Práctica</button>' +
    '<button class="btn primary" id="btn-examen" type="button">📝 Examen</button>' +
    '<button class="btn ghost" id="btn-export" type="button">Exportar JSON</button>' +
    (attempts.length ? '<button class="btn danger" id="btn-clear-hist" type="button">Vaciar historial</button>' : '') +
  '</div>';
  html += '<p class="muted modes-help"><strong>Práctica</strong>: corrige al instante y repite las falladas hasta acertarlas. · ' +
          '<strong>Examen</strong>: una sola vuelta, sin correcciones hasta el final. ' +
          'El orden de preguntas y respuestas cambia en cada intento.</p>';

  html += '<h3 class="section-title">Historial</h3>';
  if (!attempts.length) {
    html += '<div class="empty">Sin intentos todavía.</div>';
  } else {
    html += '<div class="history">';
    attempts.forEach((a, idx) => {
      const examen = a.mode === 'examen';
      html += '<div class="hist-row">' +
        '<span class="hist-pct ' + pctClass(a.pct || 0) + '">' + (a.pct != null ? a.pct : '-') + '%</span>' +
        '<span class="hist-info">' + escapeHtml(formatDateTime(a.date)) +
          ' · ' + (examen ? 'Examen' : 'Práctica') +
          ' · ' + (a.correct || 0) + '/' + (a.total || 0) +
          (examen ? '' : ' a la 1ª · ' + (a.rounds || 1) + ' ronda(s)') +
          ' · ' + formatDuration(a.seconds || 0) +
          (a.incomplete ? ' · (incompleto)' : '') + '</span>' +
        '<button class="btn danger small" data-del-att="' + idx + '" type="button" title="Borrar intento">×</button>' +
      '</div>';
    });
    html += '</div>';
  }
  html += '</section>';
  app.innerHTML = html;

  document.getElementById('btn-back').onclick = showHome;
  document.getElementById('btn-practica').onclick = () => startQuiz(id, 'practica');
  document.getElementById('btn-examen').onclick = () => startQuiz(id, 'examen');
  document.getElementById('btn-export').onclick = () => exportStack(id);
  const clr = document.getElementById('btn-clear-hist');
  if (clr) clr.onclick = () => {
    if (!confirm('¿Vaciar todo el historial de este stack?')) return;
    const h = getHistory(); delete h[id]; setHistory(h); showStackDetail(id);
  };
  app.querySelectorAll('[data-del-att]').forEach(b => b.onclick = () => {
    const i = parseInt(b.getAttribute('data-del-att'), 10);
    const h = getHistory();
    const arr = (h[id] || []).slice().sort((a, b) => (b.date || 0) - (a.date || 0));
    arr.splice(i, 1);
    h[id] = arr; setHistory(h); showStackDetail(id);
  });
}

/* ---------- Exportar / borrar stack ---------- */
function exportStack(id) {
  const s = getStacks()[id];
  if (!s) return;
  const exportObj = {
    format: FORMAT_ID, version: s.version, title: s.title, description: s.description,
    questions: s.questions.map(q => ({
      text: q.text, category: q.category,
      options: q.options.map(o => ({ text: o.text, correct: o.correct })),
      explanation: q.explanation
    }))
  };
  const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = slugify(s.title) + '.json';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function deleteStack(id) {
  const stacks = getStacks();
  if (!stacks[id]) return;
  if (!confirm('¿Borrar el stack "' + stacks[id].title + '"? Su historial se conservará.')) return;
  delete stacks[id];
  setStacks(stacks);
  showHome();
}

/* ---------- Motor del quiz ---------- */
let session = null;

// mode: 'practica' (corrección al instante + repaso de falladas) | 'examen' (corrección al final, una vuelta)
function startQuiz(stackId, mode) {
  const s = getStacks()[stackId];
  if (!s) { showHome(); return; }
  const qById = {};
  s.questions.forEach(q => { qById[q.id] = q; });
  session = {
    stackId: stackId,
    stack: s,
    qById: qById,
    mode: mode === 'examen' ? 'examen' : 'practica',
    total: s.questions.length,
    queue: shuffle(s.questions.map(q => q.id)), // orden barajado en cada intento
    round: 1,
    wrongThisRound: [],
    firstTryCorrect: new Set(),
    answeredEver: new Set(),
    everWrong: new Set(),
    startedAt: Date.now(),
    current: null
  };
  renderQuestion();
}

function renderQuestion() {
  if (!session) { showHome(); return; }
  if (session.queue.length === 0) {
    if (session.mode === 'examen') { finishQuiz(false); return; } // examen: una sola vuelta, sin repaso
    advanceRoundOrFinish();
    return;
  }

  const exam = session.mode === 'examen';
  const qid = session.queue[0];
  const q = session.qById[qid];
  const multi = q.options.filter(o => o.correct).length > 1;
  const display = shuffle(q.options.map(o => ({ text: o.text, correct: o.correct })));
  session.current = { qid: qid, q: q, display: display, multi: multi, answered: false, wasCorrect: null, selected: null };

  let header;
  if (session.round === 1) {
    const done = session.total - session.queue.length;
    header = 'Pregunta ' + (done + 1) + ' de ' + session.total;
  } else {
    header = 'Repaso · ronda ' + session.round + ' · quedan ' + session.queue.length;
  }
  header += exam ? ' · Examen' : '';
  let progressPct;
  if (exam) {
    progressPct = Math.round((session.answeredEver.size / session.total) * 100);
  } else {
    const remainingUnique = new Set(session.queue.concat(session.wrongThisRound)).size;
    progressPct = Math.round(((session.total - remainingUnique) / session.total) * 100);
  }

  let html = '<section class="view quiz">';
  html += '<div class="quiz-head"><span class="badge">' + escapeHtml(header) + '</span>' +
          '<button class="btn ghost small" id="btn-quit" type="button">Abandonar</button></div>';
  html += '<div class="progress"><div class="progress-bar" style="width:' + progressPct + '%"></div></div>';
  html += '<div class="question">';
  if (q.category) html += '<span class="chip cat"></span>';
  html += '<h3 class="q-text"></h3>';
  if (multi) html += '<p class="multi-hint">Varias respuestas correctas. Márcalas todas y pulsa <strong>' + (exam ? 'Siguiente' : 'Comprobar') + '</strong>.</p>';
  html += '<div class="options" id="options"></div>';
  html += '<div id="feedback"></div>';
  html += '<div class="quiz-actions" id="quiz-actions"></div>';
  html += '</div></section>';
  app.innerHTML = html;

  // Texto del usuario siempre vía textContent (a prueba de inyección).
  app.querySelector('.q-text').textContent = q.text;
  if (q.category) app.querySelector('.chip.cat').textContent = q.category;

  const optionsEl = document.getElementById('options');
  display.forEach((o, idx) => {
    if (multi) {
      const label = document.createElement('label');
      label.className = 'option';
      label.setAttribute('data-idx', idx);
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.value = idx;
      cb.onchange = () => label.classList.toggle('checked', cb.checked);
      const span = document.createElement('span');
      span.textContent = o.text;
      label.appendChild(cb); label.appendChild(span);
      optionsEl.appendChild(label);
    } else {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'option';
      btn.setAttribute('data-idx', idx);
      btn.textContent = o.text;
      btn.onclick = exam ? (() => examPickSingle(idx)) : (() => answerSingle(idx));
      optionsEl.appendChild(btn);
    }
  });

  const actions = document.getElementById('quiz-actions');
  if (exam) {
    const adv = document.createElement('button');
    adv.type = 'button'; adv.className = 'btn primary';
    adv.textContent = session.queue.length > 1 ? 'Siguiente' : 'Finalizar examen';
    adv.onclick = examAdvance;
    actions.appendChild(adv);
  } else if (multi) {
    const check = document.createElement('button');
    check.type = 'button'; check.className = 'btn primary'; check.id = 'btn-check';
    check.textContent = 'Comprobar';
    check.onclick = answerMulti;
    actions.appendChild(check);
  }

  document.getElementById('btn-quit').onclick = () => {
    if (confirm('¿Abandonar el test? No se guardará el intento.')) { session = null; showHome(); }
  };
}

function answerSingle(selectedIdx) {
  const cur = session.current;
  if (!cur || cur.answered) return;
  cur.answered = true;
  const correctIdxs = cur.display.map((o, i) => o.correct ? i : -1).filter(i => i >= 0);
  const isCorrect = cur.display[selectedIdx].correct === true;
  revealOptions(correctIdxs, isCorrect ? [] : [selectedIdx], []);
  recordAnswer(cur.qid, isCorrect);
  showFeedback(isCorrect, cur.q);
  showNextButton();
}

function answerMulti() {
  const cur = session.current;
  if (!cur || cur.answered) return;
  cur.answered = true;
  const checks = Array.from(document.querySelectorAll('#options input[type=checkbox]'));
  const selected = new Set(checks.filter(c => c.checked).map(c => parseInt(c.value, 10)));
  const correctIdxs = cur.display.map((o, i) => o.correct ? i : -1).filter(i => i >= 0);
  const correctSet = new Set(correctIdxs);
  let isCorrect = selected.size === correctSet.size;
  if (isCorrect) { for (const i of selected) { if (!correctSet.has(i)) { isCorrect = false; break; } } }
  const wronglyMarked = Array.from(selected).filter(i => !correctSet.has(i));
  const missed = correctIdxs.filter(i => !selected.has(i)); // correctas que faltaba marcar
  revealOptions(correctIdxs, wronglyMarked, missed);
  recordAnswer(cur.qid, isCorrect);
  showFeedback(isCorrect, cur.q);
  showNextButton();
}

function revealOptions(correctIdxs, wrongIdxs, missedIdxs) {
  missedIdxs = missedIdxs || [];
  document.querySelectorAll('#options .option').forEach(el => {
    const idx = parseInt(el.getAttribute('data-idx'), 10);
    el.classList.add('locked');
    const cb = el.querySelector('input'); if (cb) cb.disabled = true;
    if (el.tagName === 'BUTTON') el.disabled = true;
    if (correctIdxs.indexOf(idx) >= 0) el.classList.add('correct');
    if (wrongIdxs.indexOf(idx) >= 0) el.classList.add('wrong');
    if (missedIdxs.indexOf(idx) >= 0) el.classList.add('missed'); // correcta no marcada
  });
  const check = document.getElementById('btn-check');
  if (check) check.style.display = 'none';
}

function recordAnswer(qid, isCorrect) {
  if (!session.answeredEver.has(qid)) {
    session.answeredEver.add(qid);
    if (isCorrect) session.firstTryCorrect.add(qid); // el % se mide solo a la primera
  }
  if (!isCorrect) {
    session.everWrong.add(qid);
    session.wrongThisRound.push(qid);
  }
  session.current.wasCorrect = isCorrect;
}

function showFeedback(isCorrect, q) {
  const fb = document.getElementById('feedback');
  fb.innerHTML = '<div class="result-msg ' + (isCorrect ? 'ok' : 'no') + '">' +
    (isCorrect ? '✓ Correcto' : '✗ Incorrecto') + '</div>';
  if (q.explanation) {
    const exp = document.createElement('div');
    exp.className = 'explanation';
    exp.textContent = q.explanation;
    fb.appendChild(exp);
  }
}

function showNextButton() {
  const actions = document.getElementById('quiz-actions');
  actions.innerHTML = '';
  const remainingAfter = (session.queue.length - 1) + session.wrongThisRound.length;
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'btn primary';
  btn.textContent = remainingAfter > 0 ? 'Siguiente' : 'Ver resultados';
  btn.onclick = nextQuestion;
  actions.appendChild(btn);
}

function nextQuestion() {
  if (!session) { showHome(); return; }
  session.queue.shift();
  renderQuestion();
}

/* --- Modo examen: seleccionar sin corregir, avanzar puntuando en silencio --- */
function examPickSingle(idx) {
  if (!session || !session.current) return;
  session.current.selected = idx;
  document.querySelectorAll('#options .option').forEach(el => {
    el.classList.toggle('checked', parseInt(el.getAttribute('data-idx'), 10) === idx);
  });
}

function examAdvance() {
  const cur = session && session.current;
  if (!cur) return;
  const correctIdxs = cur.display.map((o, i) => o.correct ? i : -1).filter(i => i >= 0);
  const correctSet = new Set(correctIdxs);
  let selected;
  if (cur.multi) {
    const checks = Array.from(document.querySelectorAll('#options input[type=checkbox]'));
    selected = new Set(checks.filter(c => c.checked).map(c => parseInt(c.value, 10)));
  } else {
    selected = new Set(cur.selected != null ? [cur.selected] : []);
  }
  let isCorrect = selected.size === correctSet.size && selected.size > 0;
  if (isCorrect) { for (const i of selected) { if (!correctSet.has(i)) { isCorrect = false; break; } } }
  recordAnswer(cur.qid, isCorrect); // puntúa pero NO revela
  session.queue.shift();
  renderQuestion();
}

function advanceRoundOrFinish() {
  if (session.wrongThisRound.length > 0 && session.round < MAX_ROUNDS) {
    session.round += 1;
    session.queue = shuffle(session.wrongThisRound.slice());
    session.wrongThisRound = [];
    renderQuestion();
  } else {
    finishQuiz(session.wrongThisRound.length > 0); // incompleto si se topó el límite con fallos pendientes
  }
}

function finishQuiz(incomplete) {
  const endedAt = Date.now();
  const seconds = Math.round((endedAt - session.startedAt) / 1000);
  const total = session.total;
  const correct = session.firstTryCorrect.size;
  const wrong = total - correct;
  const pct = Math.round((correct / total) * 100);

  const perCategory = {};
  session.stack.questions.forEach(q => {
    const c = q.category || '(sin categoría)';
    if (!perCategory[c]) perCategory[c] = { asked: 0, correct: 0 };
    perCategory[c].asked++;
    if (session.firstTryCorrect.has(q.id)) perCategory[c].correct++;
  });

  const attempt = {
    date: endedAt, stackTitle: session.stack.title, mode: session.mode,
    total, correct, wrong, pct, seconds, rounds: session.round,
    incomplete: !!incomplete, perCategory
  };

  const history = getHistory();
  if (!history[session.stackId]) history[session.stackId] = [];
  history[session.stackId].push(attempt);
  setHistory(history);

  showResults(attempt, session);
}

/* ---------- Vista: Resultados ---------- */
function statBox(label, value) {
  return '<div class="stat"><span class="stat-val">' + escapeHtml(value) +
         '</span><span class="stat-lbl">' + escapeHtml(label) + '</span></div>';
}

function showResults(attempt, sess) {
  const failed = sess.stack.questions.filter(q => sess.everWrong.has(q.id));
  const stackId = sess.stackId;
  const mode = sess.mode;
  session = null;

  let html = '<section class="view results">';
  html += '<div class="view-head"><h2>Resultados <span class="chip">' +
          (mode === 'examen' ? 'Examen' : 'Práctica') + '</span></h2>' +
          '<button class="btn" id="btn-home" type="button">← Mis tests</button></div>';
  html += '<div class="score ' + pctClass(attempt.pct) + '">' +
          '<span class="score-num">' + attempt.pct + '%</span>' +
          '<span class="score-sub">' + (mode === 'examen' ? 'nota del examen' : 'acierto a la primera') + '</span></div>';
  if (attempt.incomplete) {
    html += '<div class="alert warn">Se alcanzó el límite de ' + MAX_ROUNDS +
            ' rondas de repaso; quedaron preguntas sin dominar.</div>';
  }

  html += '<div class="stats-grid">';
  html += statBox('Aciertos', attempt.correct + '/' + attempt.total);
  html += statBox('Fallos', String(attempt.wrong));
  html += statBox('Tiempo', formatDuration(attempt.seconds));
  html += statBox('Por pregunta', formatDuration(attempt.total ? attempt.seconds / attempt.total : 0));
  if (mode !== 'examen') html += statBox('Rondas', String(attempt.rounds));
  html += '</div>';

  const cats = Object.keys(attempt.perCategory);
  const showCats = cats.length > 1 || (cats.length === 1 && cats[0] !== '(sin categoría)');
  if (showCats) {
    html += '<h3 class="section-title">Por categoría</h3><div class="catlist">';
    cats.forEach(c => {
      const d = attempt.perCategory[c];
      const p = Math.round((d.correct / d.asked) * 100);
      html += '<div class="cat-row">' +
        '<span class="cat-name">' + escapeHtml(c) + '</span>' +
        '<span class="cat-bar"><span class="' + pctClass(p) + '" style="width:' + p + '%"></span></span>' +
        '<span class="cat-num">' + d.correct + '/' + d.asked + ' (' + p + '%)</span></div>';
    });
    html += '</div>';
  }

  if (failed.length) {
    html += '<h3 class="section-title">Para repasar (' + failed.length + ')</h3><div class="review">';
    failed.forEach(q => {
      const corrects = q.options.filter(o => o.correct).map(o => escapeHtml(o.text)).join(' · ');
      html += '<div class="review-item">' +
        '<p class="rq">' + escapeHtml(q.text) + '</p>' +
        '<p class="ra"><strong>Correcta:</strong> ' + corrects + '</p>' +
        (q.explanation ? '<p class="rexp">' + escapeHtml(q.explanation) + '</p>' : '') +
      '</div>';
    });
    html += '</div>';
  }

  html += '<div class="card-actions">' +
    '<button class="btn primary" id="btn-retry" type="button">Repetir test</button>' +
    '<button class="btn" id="btn-detail" type="button">Ver detalle e historial</button>' +
    '<button class="btn ghost" id="btn-home2" type="button">Mis tests</button></div>';
  html += '</section>';
  app.innerHTML = html;

  document.getElementById('btn-home').onclick = showHome;
  document.getElementById('btn-home2').onclick = showHome;
  document.getElementById('btn-retry').onclick = () => startQuiz(stackId, mode);
  document.getElementById('btn-detail').onclick = () => showStackDetail(stackId);
}

/* ---------- Arranque ---------- */
document.getElementById('brand').onclick = showHome;
showHome();
