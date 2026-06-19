#!/usr/bin/env node
'use strict';
/*
 * Genera tests/manifest.json a partir de los .json que haya en la carpeta tests/.
 * El manifest es la lista que la web lee para mostrar el "Catálogo" de tests,
 * porque GitHub Pages no permite listar el contenido de una carpeta en tiempo real.
 *
 * Uso:  node scripts/build-manifest.js
 * (También lo ejecuta sola la GitHub Action al hacer push.)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'tests');
const OUT = path.join(DIR, 'manifest.json');

if (!fs.existsSync(DIR)) {
  console.error('No existe la carpeta tests/. Nada que hacer.');
  fs.mkdirSync(DIR, { recursive: true });
}

const files = fs.readdirSync(DIR)
  .filter(f => f.toLowerCase().endsWith('.json') && f !== 'manifest.json')
  .sort();

const stacks = [];
const skipped = [];

for (const file of files) {
  const full = path.join(DIR, file);
  let data;
  try {
    data = JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch (e) {
    skipped.push({ file, reason: 'JSON inválido: ' + e.message });
    continue;
  }
  if (!data || data.format !== 'tests-stack' || !Array.isArray(data.questions) || data.questions.length === 0) {
    skipped.push({ file, reason: 'No es un stack válido (format/questions).' });
    continue;
  }
  const valid = data.questions.filter(q =>
    q && typeof q.text === 'string' && q.text.trim() &&
    Array.isArray(q.options) && q.options.some(o => o && o.correct === true)
  ).length;
  if (valid === 0) {
    skipped.push({ file, reason: 'Ninguna pregunta válida.' });
    continue;
  }
  stacks.push({
    file: file,
    title: (typeof data.title === 'string' && data.title.trim()) ? data.title.trim() : file.replace(/\.json$/i, ''),
    description: (typeof data.description === 'string') ? data.description.trim() : '',
    count: valid,
  });
}

const manifest = { format: 'tests-manifest', version: 1, stacks: stacks };
fs.writeFileSync(OUT, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

console.log(`manifest.json generado: ${stacks.length} stack(s).`);
stacks.forEach(s => console.log(`  · ${s.file} — "${s.title}" (${s.count} preguntas)`));
if (skipped.length) {
  console.log(`Saltados (${skipped.length}):`);
  skipped.forEach(s => console.log(`  ✗ ${s.file}: ${s.reason}`));
}
