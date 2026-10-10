# Third party notices

Lemonade itself is released under the GNU General Public License version 3 (see `LICENSE`). It ships with or is built
on the following projects.

## Electron and Chromium

The window runs on Electron, released under the MIT License: https://github.com/electron/electron. Electron includes
Chromium and its dependencies, whose licenses are listed in `LICENSES.chromium.html` next to `Lemonade.exe`.

## CMU Pronouncing Dictionary

Pronunciations used for rhymes and syllable counts come from the Carnegie Mellon University Pronouncing Dictionary,
through the `cmu-pronouncing-dictionary` package (ISC License, Copyright (c) 2015 Zeke Sikelianos).

- Dictionary: http://www.speech.cs.cmu.edu/cgi-bin/cmudict
- Package: https://github.com/words/cmu-pronouncing-dictionary

## SUBTLEX-US

Word frequencies that rank the rhymes come from SUBTLEX-US (Brysbaert and New, 2009), through the
`subtlex-word-frequencies` package (ISC License, Copyright (c) 2015 Zeke Sikelianos).

- Package: https://github.com/words/subtlex-word-frequencies

## an-array-of-english-words

The English word list that keeps names out of the rhyme dictionary comes from `an-array-of-english-words` (MIT
License, Copyright (c) 2014 Zeke Sikelianos): https://github.com/words/an-array-of-english-words

The word list, frequencies and pronunciations are combined into `data/lexicon.txt` when Lemonade is built. They are not
modified otherwise.

## Online services

These are not part of Lemonade and are only contacted when you use them:

- **Datamuse API** (https://www.datamuse.com/api/): extra rhymes, phrases, similar words and definitions while the
  online dictionary is switched on in Settings.
- **YouTube and SoundCloud**: their players, when you play a saved beat link, and the title of a link when you save it.
- **GitHub**: the update check, which can be switched off in Settings.
