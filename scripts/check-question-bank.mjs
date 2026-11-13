import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { QUESTIONS } from '../worker/questions.ts';

// Run after npm run build, using Node's type stripping. Check actual strings, not a quote-sensitive regex.
const directory = new URL('../dist/client/assets/', import.meta.url);
const bundle = readdirSync(directory).filter(name => /\.(js|map|css)$/.test(name))
  .map(name => readFileSync(new URL(name, directory), 'utf8')).join('\n');
let checked = 0;
for (const pair of QUESTIONS) {
  for (const prompt of pair.questions) {
    assert(!bundle.includes(prompt), `Private question in client assets: ${pair.id}`);
    assert(!bundle.includes(JSON.stringify(prompt).slice(1, -1)), `Escaped private question in client assets: ${pair.id}`);
    checked++;
  }
}
console.log(`Passed: all ${checked} questions from ${QUESTIONS.length} backend pairs are absent from production client assets.`);
