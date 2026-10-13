# Word-form evaluation

Measured with `node scripts/eval-morphology.mjs all [--forms]` on UniMorph tables (nouns and adjectives, up to 1 500 lemmas per language, deterministic sample; comparative/superlative forms excluded; noisy rows whose form does not start with the lemma's first letter skipped). Russian and Ukrainian are also measured with pymorphy3 dictionaries (OpenCorpora-based, exported via `scripts/export-pymorphy.py`) on 3 000 lemmas — these are more complete and give higher recall figures.

- **Recall** — share of all forms of a word that its key catches.
- **False** — share of "hard negatives" the key catches: forms of *other* words of any part of speech (verbs and prepositions included) that start with the same three letters but not with the whole keyword («секта» vs «сектор», «parada» vs «para»).
- **Longer words** — share of other words that start with the whole keyword (кот → котлета) the key catches. With prefix matching this is high by nature; many are related words (плита → плитка).

Indonesian is not measured: UniMorph has no usable noun table for it. Its nouns take endings (-nya, -an, reduplication) that prefix matching already catches; derived forms with prefixes (sihir → penyihir) come from the AI as extra forms. Checked by hand with Gemini 3.8 Flash on a few entries.

French, Italian and Portuguese UniMorph tables contain verbs only, so their nouns are not measured. Slovak uses the first 6 000 noun/adjective lemmas of a 1.6 GB table, cut by hand (not reproducible from the script alone). For Ukrainian, Polish and Slovak (stems from the AI) the script simulates the AI stem as the common prefix of all forms — a pessimistic stand-in. Form keys are built exactly as the extension builds them (the form alone, no stem). Ukrainian UniMorph has 1 416 usable lemmas.

| Language | Without forms | With AI forms (shipped for ru, uk, pl, cs, hu, de) | False (with forms) |
|---|---|---|---|
| ru | 96.8 % (UniMorph) | **98.4 %** (UniMorph) | 3.1 % |
| ru | 98.4 % (pymorphy) | **98.9 %** (pymorphy) | 1.4 % |
| uk | 92.3 % (UniMorph) | **93.9 %** (UniMorph) | 5.7 % |
| uk | 99.7 % (pymorphy) | **99.8 %** (pymorphy) | 1.3 % |
| de | 99.1 % | **100 %** | 2.1 % |
| es | 99.5 % | — | 4.1 % |
| pl | 94.2 % | **95.7 %** | 6.0 % |
| cs | 91.7 % | **96.0 %** | 5.5 % |
| sk | 99.0 % | — | 6.9 % |
| hu | 91.9 % | **97.6 %** | 3.2 % |

## Pymorphy3 evaluation (Russian and Ukrainian)

The pymorphy3 dictionaries (OpenCorpora-based) are more complete than UniMorph for Russian and Ukrainian. They give higher baseline recall and lower false-hit rates. Tested on 3 000 lemmas:

**Russian:**
- Without forms: 98.4%
- With 2 AI forms (current): 98.9%
- With 3 AI forms: 99.4% (+0.5 pp)
- Ceiling (all forms): 100%

**Ukrainian:**
- Without forms: 99.7%
- With 2 AI forms (current): 99.8%
- With 3 AI forms: 99.8% (no change)
- Ceiling (all forms): 100%

Adding a third form (genitive plural) would improve Russian recall by 0.5 percentage points but cost ~75 more output tokens per entry. For Ukrainian, the third form adds no value. **Decision: keep 2 forms** — the cost/benefit of a third form doesn't justify the token increase, especially since Ukrainian sees no gain.

## Changes

- **Long words cut to a very short stem by a local stemmer** (Spanish «cañería» → «cañ»): 7+ letters keep all but their last two letters; 6-letter words get a *closed* ending of 1–3 letters, so «parada» catches «paradas» but never the preposition «para». Never applied to stems from the AI (Polish «kupiec» → «kup» is deliberate, for «kupca»).
- **Extra forms from the AI** (genitive singular — accusative for Hungarian — and the plural), at most two per keyword: each becomes its own key when the main key does not already catch it. Forms of a stopword are ignored. A keyword equal to an author key still contributes its forms (Elara → Elary). About 150 more output tokens per entry; batches shrink automatically so replies stay under the output cap.

## Tried and rejected

- **Ukrainian case-ending list for 3-letter stems** (like Russian): recall 92.3 → 89.9 %. A 3-letter AI stem usually stops before a changed consonant (вовк → вов because of вовче), so a fixed ending list misses вовка, зірки. The generic "up to two letters" is kept.
- **Case endings instead of "any letters" for 4–5 letter stems** (ru/uk): fewer false hits (ru 3.4 → 2.3 %) but recall 98.4 → 96.8 %. A missed entry is a hole in the story; an extra one costs a few tokens.

## Known remaining misses

Stem changes a prefix cannot express: ru «вошь → вшам», «турчонок → турчатах»; uk «рів → рову», «лід → льоди»; cs «pes → psa»; hu «sátor → sátraitok». The AI forms cover them when the model lists the changed form.
