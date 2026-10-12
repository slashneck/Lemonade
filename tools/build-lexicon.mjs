// Builds data/lexicon.txt: "word<TAB>ARPABET[|ALTERNATE...]<TAB>frequency" for every useful English word,
// and data/spell.txt: every word the spell checker accepts, "word[<TAB>frequency]", for offline spelling.
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
const properCount = new Map();
for (const { word, count } of subtlex) {
  const lw = word.toLowerCase();
  // Subtitles start sentences with capitals: "Listen" is still the word listen. Only capitalized words that aren't
  // English words are names.
  if (word !== lw && word !== 'I' && !english.has(lw)) { proper.add(lw); properCount.set(lw, (properCount.get(lw) || 0) + count); }
  else freq.set(lw, (freq.get(lw) || 0) + count);
}

const slangSrc = readFileSync(new URL('../src/slang.js', import.meta.url), 'utf8');
const slang = new Set(
  [...slangSrc.matchAll(/^([^|\n`]+)\|/gm)].map((m) => m[1].trim().toLowerCase().split(' ').pop())
);

const keepApostrophe = new Set(["ain't", "y'all", "'bout", "'cause", "'em", "'til", "can't", "don't", "won't", "didn't", "doesn't", "isn't", "wasn't", "couldn't", "wouldn't", "shouldn't", "i'm", "you're", "we're", "they're", "it's", "that's", "what's", "i'll", "you'll", "we'll", "i've", "i'd", "let's", "o'clock", "rock'n'roll"]);

// Alternate pronunciations ("on" is both AA N and AO N) are kept after the main one, separated by |
const variants = new Map();
for (const [key, pron] of Object.entries(dictionary)) {
  const w = key.replace(/\(\d+\)$/, '').toLowerCase();
  if (!variants.has(w)) variants.set(w, []);
  if (key.includes('(')) variants.get(w).push(pron); else variants.get(w).unshift(pron);
}

const out = [];
for (const [w, prons] of variants) {
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
  out.push(`${w}\t${[...new Set(prons)].join('|')}\t${f}`);
}

mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
writeFileSync(new URL('../data/lexicon.txt', import.meta.url), out.join('\n'));
console.log(`lexicon: ${out.length} words`);

// Spelling: the full English word list, words people actually say (SUBTLEX), names and places that turn up often,
// and the contractions and slang of the pronouncing dictionary.
const spell = new Set(english);
for (const [w, f] of freq) if (f >= 3 && /^[a-z]+$/.test(w)) spell.add(w);
for (const [w, f] of properCount) if (f >= 20 && /^[a-z]+$/.test(w)) spell.add(w);
for (const key of variants.keys()) if (/^[a-z]+'[a-z]+$|^'[a-z]+$/.test(key)) spell.add(key);
for (const w of slang) if (/^[a-z']+$/.test(w)) spell.add(w);
const spellOut = [...spell].filter((w) => w.length > 1 || w === 'a' || w === 'i').sort()
  .map((w) => (freq.get(w) ? `${w}\t${freq.get(w)}` : w));
writeFileSync(new URL('../data/spell.txt', import.meta.url), spellOut.join('\n'));
console.log(`spelling: ${spellOut.length} words`);
