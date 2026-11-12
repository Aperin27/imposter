import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
const color = name => {
  const match = css.match(new RegExp(`--${name}:\\s*(#[a-f0-9]{6})`, 'i'));
  assert(match, `Missing palette token: ${name}`);
  return match[1];
};
function luminance(hex) {
  const rgb = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
}
for (const [foreground, background] of [
  ['ink', 'red'], ['ink', 'paper'], ['red', 'bg'], ['gold', 'bg'],
  ['muted', 'bg'], ['ink-muted', 'paper'], ['red-ink', 'paper'],
]) {
  const values = [luminance(color(foreground)), luminance(color(background))].sort((a, b) => a - b);
  const ratio = (values[1] + .05) / (values[0] + .05);
  assert(ratio >= 4.5, `${foreground} on ${background} fails normal-text AA contrast`);
  console.log(`${foreground} on ${background}: ${ratio.toFixed(2)}:1`);
}
assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
assert.match(css, /animation:\s*none!important/);
assert.match(css, /transition:\s*none!important/);
assert.match(css, /@media\s*\(hover:\s*hover\) and \(pointer:\s*fine\)/);
assert(css.includes('env(safe-area-inset-bottom)') && css.includes('100dvh'));
console.log('Passed: palette contrast, reduced-motion, hover and viewport safeguards.');
