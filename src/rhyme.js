// Phonetic rhyme engine built on CMU ARPAbet pronunciations.
(() => {
  const isVowel = (ph) => /\d$/.test(ph);
  const strip = (ph) => ph.replace(/\d$/, '');

  // Final-consonant families: words ending in the same family make good slant rhymes.
  const FAMILY = {
    P: 'stop', B: 'stop', T: 'stop', D: 'stop', K: 'stop', G: 'stop',
    M: 'nasal', N: 'nasal', NG: 'nasal',
    F: 'fric', V: 'fric', TH: 'fric', DH: 'fric', S: 'fric', Z: 'fric', SH: 'fric', ZH: 'fric', HH: 'fric',
    CH: 'aff', JH: 'aff', L: 'liq', R: 'liq', W: 'glide', Y: 'glide',
  };

  const STOP = new Set(('a an the and or but to of in on at by for from with as is are was were be been am i im ' +
    'me my you your he him his she her it its we us our they them their this that these those so if then than ' +
    'do does did not no yes up out just like get got go all can will would could should what when where who how ' +
    'yeah uh oh ay ah huh').split(' '));

  // Pronunciations for slang the CMU dictionary doesn't know (or says wrong)
  const PRON = {
    guap: 'G W AA1 P', gwap: 'G W AA1 P', nocap: 'N OW1 K AE1 P', ms: 'EH1 M Z', js: 'JH EY1 Z',
    ap: 'EY1 P IY1', og: 'OW1 JH IY1', vvs: 'V IY1 V IY1 EH1 S', za: 'Z AA1', rari: 'R AA1 R IY0',
    lambo: 'L AE1 M B OW0', skrrt: 'S K ER1 T', bando: 'B AE1 N D OW0', opps: 'AA1 P S', opp: 'AA1 P',
    op: 'AA1 P', finna: 'F IH1 N AH0', tryna: 'T R AY1 N AH0', gyat: 'G Y AE1 T', rizz: 'R IH1 Z',
    sus: 'S AH1 S', yeet: 'Y IY1 T', deadass: 'D EH1 D AE2 S', henny: 'HH EH1 N IY0', juug: 'JH AH1 G',
    jugg: 'JH AH1 G', glizzy: 'G L IH1 Z IY0', draco: 'D R AA1 K OW0', blick: 'B L IH1 K',
    hitta: 'HH IH1 T AH0', choppa: 'CH AA1 P AH0', hunnid: 'HH AH1 N IH0 D', hunnids: 'HH AH1 N IH0 D Z',
    durag: 'D UW1 R AE2 G', steez: 'S T IY1 Z', zooted: 'Z UW1 T IH0 D', plugg: 'P L AH1 G',
    rollie: 'R OW1 L IY0', patek: 'P AH0 T EH1 K', endz: 'EH1 N D Z', bussin: 'B AH1 S IH0 N',
    shawty: 'SH AO1 T IY0', bruh: 'B R AH1', ong: 'AO1 NG', frfr: 'F ER1 R IY1 L F ER1 R IY1 L',
    fr: 'F ER1 R IY1 L', twelve: 'T W EH1 L V', fetti: 'F EH1 T IY0', scrilla: 'S K R IH1 L AH0',
    skrilla: 'S K R IH1 L AH0', milli: 'M IH1 L IY0', youngin: 'Y AH1 NG IH0 N', bustdown: 'B AH1 S T D AW2 N',
    traphouse: 'T R AE1 P HH AW2 S', droptop: 'D R AA1 P T AA2 P', boombap: 'B UW1 M B AE2 P',
    turnup: 'T ER1 N AH2 P', reup: 'R IY0 AH1 P', glowup: 'G L OW1 AH2 P', pullup: 'P UH1 L AH2 P',
    ongod: 'AA1 N G AA1 D', goated: 'G OW1 T IH0 D', baddie: 'B AE1 D IY0', thot: 'TH AA1 T',
    yak: 'Y AE1 K', locs: 'L OW1 K S', hats: 'HH AE1 T S', prod: 'P R AA1 D', plugg: 'P L AH1 G',
    phonk: 'F AA1 NG K', vette: 'V EH1 T', rari: 'R AA1 R IY0', wraith: 'R EY1 TH', cullinan: 'K AH1 L IH0 N AH0 N',
    hellcat: 'HH EH1 L K AE2 T', adlib: 'AE1 D L IH2 B', adlibs: 'AE1 D L IH2 B Z', hihat: 'HH AY1 HH AE2 T',
    emcee: 'EH1 M S IY1', mc: 'EH1 M S IY1', dj: 'D IY1 JH EY1', bpm: 'B IY1 P IY1 EH1 M',
    atl: 'EY1 T IY1 EH1 L', bk: 'B IY1 K EY1', chi: 'SH AY1', popo: 'P OW1 P OW0', yall: 'Y AO1 L',
    flossin: 'F L AO1 S IH0 N', vibin: 'V AY1 B IH0 N',
  };

  class RhymeEngine {
    constructor() {
      this.words = new Map(); // word -> { p: string[], f: number }
      this.slang = new Map(); // word -> { def, cat }
      this.ready = false;
      this.guessCache = new Map();
    }

    load(text, slangRaw) {
      for (const line of text.split('\n')) {
        const [w, p, f] = line.split('\t');
        if (w) this.words.set(w, { p: p.split(' '), f: +f || 0 });
      }
      for (const [w, p] of Object.entries(PRON)) {
        const prev = this.words.get(w);
        this.words.set(w, { p: p.split(' '), f: prev ? prev.f : 0 });
      }
      for (const line of slangRaw.split('\n')) {
        const [w, def, cat] = line.split('|');
        if (!w || !def) continue;
        const key = w.trim().toLowerCase();
        const prev = this.slang.get(key);
        if (prev) { if (!prev.def.includes(def)) prev.def += '; ' + def; }
        else this.slang.set(key, { word: w.trim(), def: def.trim(), cat: (cat || '').trim() });
      }
      this.reversed = [...this.words.keys()].map((w) => [...w].reverse().join('')).sort();
      this.buildIndex();
      this.ready = true;
    }

    buildIndex() {
      this.byPerfect = new Map();
      this.byVowel = new Map();
      this.byTail2 = new Map();
      this.byTail3 = new Map();
      const all = new Set([...this.words.keys(), ...[...this.slang.keys()].filter((k) => !k.includes(' '))]);
      for (const w of all) this.indexWord(w);
    }

    indexKeys(w) {
      const ph = this.phones(w);
      if (!ph) return [];
      return [[this.byPerfect, this.perfectKey(ph)], [this.byVowel, this.vowelKey(ph)],
        [this.byTail2, this.tailVowels(ph, 2)], [this.byTail3, this.tailVowels(ph, 3)]];
    }
    indexWord(w) {
      for (const [m, k] of this.indexKeys(w)) {
        if (!k) continue;
        let a = m.get(k);
        if (!a) m.set(k, (a = []));
        if (!a.includes(w)) a.push(w);
      }
    }
    unindexWord(w) {
      for (const [m, k] of this.indexKeys(w)) {
        const a = m.get(k);
        if (a) { const i = a.indexOf(w); if (i >= 0) a.splice(i, 1); }
      }
    }

    // User-added words. `rhymesWith` lends its pronunciation (e.g. "guap" rhymes with "top").
    addWord(word, def, cat, rhymesWith) {
      const key = RhymeEngine.clean(word.trim().split(/\s+/).pop()) && word.trim().toLowerCase();
      if (!key) return;
      const single = !key.includes(' ');
      if (single) this.unindexWord(key);
      const prev = this.slang.get(key);
      this.slang.set(key, { word: word.trim(), def, cat: cat || 'yours', custom: true, prev: prev && !prev.custom ? prev : prev?.prev });
      if (single && rhymesWith) {
        const p = this.phones(rhymesWith);
        if (p) { this.words.set(key, { p: [...p], f: this.freq(key), custom: true }); this.guessCache.delete(key); }
      }
      if (single) this.indexWord(key);
    }
    removeWord(key) {
      const s = this.slang.get(key);
      if (!s?.custom) return;
      const single = !key.includes(' ');
      if (single) this.unindexWord(key);
      if (s.prev) this.slang.set(key, s.prev); else this.slang.delete(key);
      if (this.words.get(key)?.custom) this.words.delete(key);
      this.guessCache.delete(key);
      if (single && (this.words.has(key) || this.slang.has(key))) this.indexWord(key);
    }

    // words that sound alike (same vowel pattern) - used for "similar sound" lookups
    soundsLike(word) { const ph = this.phones(word); return ph ? this.byVowel.get(this.vowelKey(ph)) || [] : []; }

    static clean(word) {
      let w = (word || '').toLowerCase().replace(/[’‘`]/g, "'").replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, '');
      if (w.startsWith("'") && !/^'(bout|cause|em|til)$/.test(w)) w = w.replace(/^'+/, '');
      return w;
    }

    phones(word) {
      const w = RhymeEngine.clean(word);
      if (!w) return null;
      const hit = this.words.get(w);
      if (hit) return hit.p;
      return this.guess(w);
    }

    has(word) { return this.words.has(RhymeEngine.clean(word)); }
    freq(word) { return this.words.get(word)?.f || 0; }

    // Guess a pronunciation for slang / unknown words.
    guess(w) {
      if (this.guessCache.has(w)) return this.guessCache.get(w);
      let p = null;
      const tryWord = (x) => this.words.get(x)?.p;
      // trappin / trappin' -> trapping (with N instead of NG)
      const base = w.replace(/'$/, '');
      if (!p && /in$/.test(base)) {
        const g = tryWord(base + 'g') || tryWord(base.replace(/in$/, 'ing'));
        if (g) p = g.map((x, i) => (i === g.length - 1 && x === 'NG' ? 'N' : x));
      }
      // hitta / choppa -> hitter / chopper
      if (!p && /a$/.test(base)) {
        const g = tryWord(base.replace(/a$/, 'er'));
        if (g) p = g.map((x, i) => (i === g.length - 1 && /^ER/.test(x) ? 'AH0' : x));
      }
      if (!p && /z$/.test(base)) p = tryWord(base.replace(/z$/, 's'));
      if (!p && /s$/.test(base)) { const g = tryWord(base.slice(0, -1)); if (g) p = [...g, 'Z']; }
      // Longest spelling-suffix match against the lexicon
      if (!p && base.length >= 3) {
        const rev = [...base].reverse().join('');
        for (let len = Math.min(rev.length - 1, 6); len >= 2 && !p; len--) {
          const pre = rev.slice(0, len);
          let lo = 0, hi = this.reversed.length;
          while (lo < hi) { const mid = (lo + hi) >> 1; if (this.reversed[mid] < pre) lo = mid + 1; else hi = mid; }
          // choose the most frequent among first few matches
          let best = null, bestF = -1;
          for (let i = lo; i < Math.min(lo + 40, this.reversed.length) && this.reversed[i].startsWith(pre); i++) {
            const cand = [...this.reversed[i]].reverse().join('');
            const f = this.freq(cand);
            if (f > bestF) { bestF = f; best = cand; }
          }
          if (best) {
            const bp = this.words.get(best).p;
            const idx = this.stressIndex(bp);
            const sylls = RhymeEngine.heuristicSyllables(base);
            const tail = bp.slice(idx);
            const tailVowels = tail.filter(isVowel).length;
            const pad = Math.max(0, sylls - tailVowels);
            p = [...Array(pad).fill('AH0'), ...tail];
          }
        }
      }
      this.guessCache.set(w, p);
      return p;
    }

    static heuristicSyllables(w) {
      const m = w.toLowerCase().replace(/e$/, '').match(/[aeiouy]+/g);
      return Math.max(1, m ? m.length : 1);
    }

    syllables(word) {
      const ph = this.phones(word);
      if (ph) return ph.filter(isVowel).length || 1;
      return RhymeEngine.heuristicSyllables(word);
    }

    stressIndex(ph) {
      // The rhyme starts at the last stressed vowel (primary or secondary): paranoid -> "oid"
      let is = -1, iv = -1;
      ph.forEach((x, i) => {
        if (!isVowel(x)) return;
        iv = i;
        if (x.endsWith('1') || x.endsWith('2')) is = i;
      });
      return is >= 0 ? is : Math.max(iv, 0);
    }
    perfectKey(ph) { return ph.slice(this.stressIndex(ph)).map(strip).join(' '); }
    vowelKey(ph) { return ph.slice(this.stressIndex(ph)).filter(isVowel).map(strip).join(' '); }
    tailVowels(ph, n) {
      const v = ph.filter(isVowel).map(strip);
      return v.length >= n ? v.slice(-n).join(' ') : '';
    }
    finalFamily(ph) {
      const last = ph[ph.length - 1];
      return isVowel(last) ? 'open' : FAMILY[last] || last;
    }

    // Vowel-sound sequence for the end of a line (for multisyllabic matches)
    lineTail(text, n) {
      const ws = (text.match(/[a-zA-Z']+/g) || []).slice(-4);
      const ph = ws.flatMap((w) => this.phones(w) || []);
      return this.tailVowels(ph, n);
    }

    rank(list, exclude) {
      return [...new Set(list)]
        .filter((w) => w !== exclude)
        .sort((a, b) => (this.slang.has(b) - this.slang.has(a)) || this.freq(b) - this.freq(a));
    }

    // Returns { perfect: [[word, syllables]], near, multi, slang }
    find(word, lineText = '') {
      const w = RhymeEngine.clean(word);
      const ph = this.phones(w);
      const out = { word: w, perfect: [], near: [], multi: [], slang: [], phones: ph };
      if (!ph) return out;
      const pk = this.perfectKey(ph);
      const vk = this.vowelKey(ph);
      const fam = this.finalFamily(ph);

      const perfect = this.rank(this.byPerfect.get(pk) || [], w);
      const perfectSet = new Set(perfect);
      const nearRaw = (this.byVowel.get(vk) || []).filter((x) => !perfectSet.has(x) && x !== w);
      const near = this.rank(nearRaw, w).sort((a, b) => {
        const fa = this.finalFamily(this.phones(a)) === fam, fb = this.finalFamily(this.phones(b)) === fam;
        return fb - fa;
      });

      const multi = [];
      const seen = new Set([w, ...perfect.slice(0, 60)]);
      for (const n of [3, 2]) {
        const key = lineText ? this.lineTail(lineText, n) : this.tailVowels(ph, n);
        if (!key) continue;
        const pool = (n === 3 ? this.byTail3 : this.byTail2).get(key) || [];
        for (const x of this.rank(pool, w)) {
          if (seen.has(x) || this.syllables(x) < n) continue;
          seen.add(x); multi.push(x);
        }
      }

      const slang = [...this.slang.keys()].filter((s) => {
        if (s === w) return false;
        const sp = this.phones(s.split(' ').pop());
        if (!sp) return false;
        return this.perfectKey(sp) === pk || this.vowelKey(sp) === vk;
      });

      const tag = (x) => [x, this.syllables(x)];
      out.perfect = perfect.slice(0, 160).map(tag);
      out.near = near.slice(0, 120).map(tag);
      out.multi = multi.slice(0, 80).map(tag);
      out.slang = slang.slice(0, 60).map(tag);
      return out;
    }

    // Key used to group words that rhyme with each other (assonance-level)
    groupKey(word) {
      const ph = this.phones(word);
      if (!ph) return null;
      return this.vowelKey(ph) + '|' + this.finalFamily(ph);
    }
    endKey(word) {
      const ph = this.phones(word);
      return ph ? this.vowelKey(ph) : null;
    }
    isStop(w) { return STOP.has(RhymeEngine.clean(w)); }
  }

  window.RhymeEngine = RhymeEngine;
})();
