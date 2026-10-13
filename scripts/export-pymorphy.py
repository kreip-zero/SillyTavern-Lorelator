# Exports nouns and adjectives with all their forms from pymorphy3 dictionaries (OpenCorpora for Russian,
# its Ukrainian counterpart) into UniMorph-like TSV: lemma<TAB>form<TAB>features.
# Usage: python -I scripts/export-pymorphy.py ru|uk OUT [--limit 20000]
import sys
import pymorphy3

lang, out_path = sys.argv[1], sys.argv[2]
limit = int(sys.argv[sys.argv.index('--limit') + 1]) if '--limit' in sys.argv else 20000
morph = pymorphy3.MorphAnalyzer(lang=lang)
CASES = {'nomn': 'NOM', 'gent': 'GEN', 'datv': 'DAT', 'accs': 'ACC', 'ablt': 'INS', 'loct': 'ESS', 'voct': 'VOC', 'gen2': 'GEN', 'loc2': 'ESS', 'acc2': 'ACC'}
seen = set()
written = 0
with open(out_path, 'w', encoding='utf-8') as out:
    for word, tag, normal_form, para_id, idx in morph.dictionary.iter_known_words():
        if written >= limit:
            break
        if idx != 0 or normal_form in seen or not normal_form.isalpha():
            continue
        pos = tag.POS
        if pos not in ('NOUN', 'ADJF'):
            continue
        if 'Name' in tag or 'Surn' in tag or 'Patr' in tag or 'Abbr' in tag:
            continue
        seen.add(normal_form)
        parse = next((p for p in morph.parse(word) if p.normal_form == normal_form and p.tag.POS == pos), None)
        if not parse:
            continue
        for f in parse.lexeme:
            case = CASES.get(f.tag.case, 'X')
            number = 'PL' if f.tag.number == 'plur' else 'SG'
            out.write(f"{normal_form}\t{f.word}\t{'N' if pos == 'NOUN' else 'ADJ'};{case};{number}\n")
        written += 1
print(written)
