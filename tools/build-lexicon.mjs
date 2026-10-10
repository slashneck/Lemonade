// Builds data/lexicon.txt: "word<TAB>ARPABET<TAB>frequency" for every useful English word.
// Sources: CMU Pronouncing Dictionary (pronunciations) + SUBTLEX-US (frequencies)
// + an-array-of-english-words (filters out proper names).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dictionary } from 'cmu-pronouncing-dictionary';

const require = createRequire(import.meta.url);
const english = new Set(require('an-array-of-english-words'));
const subtlex = require('subtlex-word-frequencies/index.json');

const freq = new Map();
const proper = new Set();
for (const { word, count } of subtlex) {
  const lw = word.toLowerCase();
  if (word !== lw && word !== 'I') proper.add(lw);
  else freq.set(lw, (freq.get(lw) || 0) + count);
}

const slangSrc = readFileSync(new URL('../src/slang.js', import.meta.url), 'utf8');
const slang = new Set(
  [...slangSrc.matchAll(/^([^|\n`]+)\|/gm)].map((m) => m[1].trim().toLowerCase().split(' ').pop())
);

const keepApostrophe = new Set(["ain't", "y'all", "'bout", "'cause", "'em", "'til", "can't", "don't", "won't", "didn't", "doesn't", "isn't", "wasn't", "couldn't", "wouldn't", "shouldn't", "i'm", "you're", "we're", "they're", "it's", "that's", "what's", "i'll", "you'll", "we'll", "i've", "i'd", "let's", "o'clock", "rock'n'roll"]);

const out = [];
for (const [key, pron] of Object.entries(dictionary)) {
  if (key.includes('(')) continue; // keep primary pronunciation only
  const w = key.toLowerCase();
  if (w.includes("'") && !keepApostrophe.has(w)) continue;
  if (/[^a-z']/.test(w)) continue;
  const f = freq.get(w) || 0;
  const isSlang = slang.has(w);
  const inDict = english.has(w);
  if (!isSlang) {
    if (!inDict && f < 30) continue;            // not a real word / too rare
    if (!inDict && proper.has(w) && f < 500) continue; // mostly a name
    if (w.length === 1 && w !== 'a' && w !== 'i') continue;
  }
  out.push(`${w}\t${pron}\t${f}`);
}

mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
writeFileSync(new URL('../data/lexicon.txt', import.meta.url), out.join('\n'));
console.log(`lexicon: ${out.length} words`);
