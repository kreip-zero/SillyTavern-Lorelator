import { test } from 'node:test';
import assert from 'node:assert/strict';
import { phraseToKey, buildKeys } from '../src/morphology.js';
import { toRegExp } from './helpers.js';

const re = (text, lang, stem) => toRegExp(phraseToKey({ text, stem }, lang));

test('ru stem key matches inflections, not neighbours', () => {
    const r = re('тёмное братство', 'ru');
    assert.ok(r.test('Он вступил в Тёмного Братства ряды'));
    assert.ok(r.test('темному братству'));
    assert.ok(!r.test('светлое братство'));
});

test('short stem uses whole word with short endings only', () => {
    const r = re('кот', 'ru');
    assert.ok(r.test('Кот спит'));
    assert.ok(r.test('погладил кота'));
    assert.ok(!r.test('кофе'));
    assert.ok(!r.test('котлетами'));
    assert.ok(!r.test('скот'));
});

test('special characters are literal and key parses in ST format', () => {
    const key = phraseToKey({ text: 'A.I. (v2)/beta?' }, 'de');
    const r = toRegExp(key);
    assert.ok(r, key);
    assert.ok(r.test('the A.I. (v2)/beta? model'));
    assert.ok(!r.test('the AxIx (v2)/beta? model'));
});

test('hyphen and uppercase', () => {
    assert.ok(re('Северо-Запад', 'ru').test('на СЕВЕРО-ЗАПАДЕ'));
});

test('ai stem language uses provided stem', () => {
    const r = re('темне братство', 'uk', 'темн братств');
    assert.ok(r.test('темного братства'));
});

test('ai stem with mismatched word count falls back to whole words', () => {
    const r = re('темне братство', 'uk', 'темн');
    assert.ok(r.test('темне братство'));
    assert.ok(!r.test('темного братства'));
});

test('ja substring', () => {
    assert.ok(re('闇の一党', 'ja').test('彼は闇の一党に入った'));
});

test('stopwords and duplicates dropped', () => {
    assert.equal(phraseToKey({ text: 'время' }, 'ru'), null);
    assert.equal(phraseToKey({ text: '   ' }, 'ru'), null);
    const keys = buildKeys([{ text: 'дракон' }, { text: 'драконы' }, { text: 'dragon' }], 'ru', ['dragon']);
    assert.equal(keys.length, 1);
    assert.equal(keys[0].phrase, 'дракон');
});

test('ru fleeting vowel in the last syllable is optional', () => {
    const r = re('чёрный рынок', 'ru');
    assert.ok(r.test('спорили о чёрном рынке'));
    assert.ok(r.test('чёрный рынок'));
    const father = re('отец', 'ru');
    assert.ok(father.test('у отца'));
    assert.ok(re('ветер', 'ru').test('на ветру'));
});

test('very short stems become exact whole words', () => {
    const fight = re('бой', 'ru');
    assert.ok(fight.test('начался бой'));
    for (const w of ['бок', 'бог', 'боль']) assert.ok(!fight.test(w), w);
    const heaven = re('рай', 'ru');
    for (const w of ['раз', 'рад', 'рано']) assert.ok(!heaven.test(w), w);
    const dog = re('pes', 'cs');
    for (const w of ['po', 'pro', 'pan']) assert.ok(!dog.test(w), w);
    const horse = re('кінь', 'uk', 'к');
    assert.ok(horse.test('кінь'));
    assert.ok(!horse.test('як'));
});

test('ru 3-letter stems accept noun endings only', () => {
    const lion = re('лев', 'ru');
    assert.ok(lion.test('лева'));
    assert.ok(lion.test('лев'));
    assert.ok(!lion.test('левый берег'));
});

test('ru fleeting vowel rule does not hit unrelated words', () => {
    assert.ok(!re('город', 'ru').test('гордый'));
    assert.ok(!re('мороз', 'ru').test('Морзе'));
    assert.ok(!re('череп', 'ru').test('черпать'));
    assert.ok(!re('порох', 'ru').test('порхать'));
    assert.ok(re('отец', 'ru').test('у отца'));
    assert.ok(!re('рынок', 'ru').test('рынкообразный'));
});

test('accents do not block inflected forms', () => {
    assert.ok(re('dragón', 'es').test('los dragones'));
    assert.ok(re('león', 'es').test('dos leones'));
    assert.ok(re('dragão', 'pt').test('os dragões'));
    assert.ok(re('madár', 'hu').test('a madarak'));
    assert.ok(re('Wolf', 'de').test('die Wölfe'));
    assert.ok(re('épée', 'fr').test('une epee'));
});

test('ru soft-sign endings after a short stem', () => {
    const potion = re('зелье лечения', 'ru');
    assert.ok(potion.test('почём тут зелье лечения'));
    assert.ok(potion.test('нет зелья лечения'));
    assert.ok(re('зелье', 'ru').test('выпил зельем'));
});

test('ru -он is not treated as a fleeting vowel', () => {
    assert.ok(!phraseToKey({ text: 'дракон' }, 'ru').includes('дракн'));
    assert.ok(re('дракон', 'ru').test('драконами'));
});

test('a short-stem key always matches the word it was made from', () => {
    for (const word of ['змей', 'бой', 'рай', 'лев', 'кот', 'pes']) {
        const lang = word === 'pes' ? 'cs' : 'ru';
        assert.ok(re(word, lang).test(`вот ${word} тут`), word);
    }
    assert.ok(re('змей', 'ru').test('огромного змея'));
});

test('long words cut to a short stem still match their longer forms', () => {
    assert.ok(re('cañería', 'es').test('las cañerías'));
    assert.ok(re('debido', 'es').test('la debida'));
    assert.ok(!re('debido', 'es').test('deberes'));
});

test('Ukrainian short stems allow up to two extra letters (measured better than a fixed ending list)', () => {
    assert.ok(re('хата', 'uk', 'хат').test('у хаті'));
    assert.ok(re('хата', 'uk', 'хат').test('дві хати'));
    assert.ok(!re('хата', 'uk', 'хат').test('хатинка'));
});

test('Latin or mixed-alphabet keywords are dropped for languages not written in Latin letters', () => {
    const phrases = buildKeys([{ text: 'docks' }, { text: 'дocks' }, { text: 'шлюха' }], 'ru', []).map(p => p.phrase);
    assert.deepEqual(phrases, ['шлюха']);
    assert.equal(buildKeys([{ text: 'Hafen' }], 'de', []).length, 1);
});

test('Indonesian: the word itself is the stem, so endings and reduplication are caught', () => {
    const key = toRegExp(phraseToKey({ text: 'pedang' }, 'id'));
    for (const form of ['pedang', 'pedangnya', 'pedang-pedang', 'Pedangku']) assert.ok(key.test(` ${form} `), form);
    assert.equal(key.test(' sepedang '), false);
    const phrase = toRegExp(phraseToKey({ text: 'penjaga kedai' }, 'id'));
    assert.ok(phrase.test(' penjaga kedainya '));
    assert.equal(phraseToKey({ text: 'orang' }, 'id'), null, 'stopword');
    // derived forms come from the AI as extra keys
    const keys = buildKeys([{ text: 'obat', forms: ['pengobatan', 'mengobati'] }], 'id', []);
    assert.equal(keys.length, 3);
    assert.ok(keys.some(k => toRegExp(k.key).test(' pengobatan ')));
});

test('a 4-letter stem left of a long word is lengthened, so it does not catch unrelated words', () => {
    const milk = toRegExp(phraseToKey({ text: 'подоить' }, 'ru'));
    assert.ok(milk.test(' подоила '));
    assert.equal(milk.test(' подойти '), false);
    const friction = toRegExp(phraseToKey({ text: 'трение' }, 'ru'));
    for (const form of ['трение', 'трения', 'трением']) assert.ok(friction.test(` ${form} `), form);
    assert.equal(friction.test(' тренировки '), false);
    assert.ok(toRegExp(phraseToKey({ text: 'знание' }, 'ru')).test(' знаниями '));
});

test('a short Russian stem takes at most five more letters (член is not членораздельно)', () => {
    const member = toRegExp(phraseToKey({ text: 'член' }, 'ru'));
    for (const form of ['член', 'члена', 'членом', 'членами']) assert.ok(member.test(` ${form} `), form);
    assert.equal(member.test(' членораздельно '), false);
    const market = toRegExp(phraseToKey({ text: 'рынок' }, 'ru'));
    for (const form of ['рынок', 'рынка', 'рынками']) assert.ok(market.test(` ${form} `), form);
});

test('Russian pronouns and adverbs never become keys', () => {
    for (const word of ['мой', 'моё', 'внутри', 'сверху', 'вход']) assert.equal(phraseToKey({ text: word }, 'ru'), null, word);
    assert.ok(phraseToKey({ text: 'ты моя' }, 'ru'), 'a phrase with a pronoun is still fine');
});
