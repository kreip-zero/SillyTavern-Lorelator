import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyGreetings, buildGreetingPrompt, checkPreserved, collectGreetings, parseGreetings } from '../src/greetings.js';

test('collectGreetings lists first and alternates, skips empty', () => {
    const card = { first_mes: 'Hi', data: { alternate_greetings: ['A', '  ', 'B'] } };
    assert.deepEqual(collectGreetings(card).map(g => g.id), ['first', 'alt:0', 'alt:2']);
});

test('collectGreetings falls back to data.first_mes and tolerates missing arrays', () => {
    assert.deepEqual(collectGreetings({ data: { first_mes: 'X' } }), [{ id: 'first', text: 'X' }]);
    assert.deepEqual(collectGreetings({}), []);
    assert.deepEqual(collectGreetings({ first_mes: '', data: {} }), []);
});

test('buildGreetingPrompt: tags, language, keep-markup sentence without rules', () => {
    const prompt = buildGreetingPrompt([{ id: 'first', text: '*waves* "Hi, {{user}}"' }, { id: 'alt:0', text: 'Plain' }], 'ru');
    assert.match(prompt, /Russian/);
    assert.match(prompt, /<greeting id="first">\*waves\* "Hi, \{\{user\}\}"<\/greeting>/);
    assert.match(prompt, /<greeting id="alt:0">Plain<\/greeting>/);
    assert.match(prompt, /Keep every markup symbol/);
    assert.match(prompt, /\{\{char\}\}/);
    assert.doesNotMatch(prompt, /<format_rules>/);
    assert.doesNotMatch(prompt, /persona|character card/i);
});

test('buildGreetingPrompt: rules replace the keep-markup sentence', () => {
    const prompt = buildGreetingPrompt([{ id: 'first', text: 'Hi' }], 'de', { rules: 'Speech in double quotes.' });
    assert.match(prompt, /<format_rules>\s*Speech in double quotes\.\s*<\/format_rules>/);
    assert.doesNotMatch(prompt, /Keep every markup symbol/);
    assert.match(prompt, /German/);
});

test('parseGreetings reads tagged replies with prose and fences around them', () => {
    const reply = 'Here you go:\n```\n<greeting id="first">*Привет*\n"Как дела?" <b>да</b></greeting>\n<greeting id="alt:0">Второе</greeting>\n```';
    const { ok, failed } = parseGreetings(reply, ['first', 'alt:0']);
    assert.equal(ok.get('first'), '*Привет*\n"Как дела?" <b>да</b>');
    assert.equal(ok.get('alt:0'), 'Второе');
    assert.deepEqual(failed, []);
});

test('parseGreetings reports missing ids as failed and ignores unknown ones', () => {
    const { ok, failed } = parseGreetings('<greeting id="first">A</greeting><greeting id="zzz">B</greeting>', ['first', 'alt:1']);
    assert.deepEqual([...ok.keys()], ['first']);
    assert.deepEqual(failed, ['alt:1']);
});

test('parseGreetings: a closing tag inside the text does not cut it when more text follows', () => {
    const { ok } = parseGreetings('<greeting id="first">a </greeting> b</greeting>\n<greeting id="alt:0">c</greeting>', ['first', 'alt:0']);
    assert.equal(ok.get('first'), 'a </greeting> b');
    assert.equal(ok.get('alt:0'), 'c');
});

test('checkPreserved flags lost macros, html, fences and comments', () => {
    assert.deepEqual(checkPreserved('Hi {{user}}', 'Привет'), ['macro']);
    assert.deepEqual(checkPreserved('Hi', 'Привет {{user}}'), ['macro']);
    assert.deepEqual(checkPreserved('<b>x</b> <i>y</i>', '<b>x</b> y'), ['html']);
    assert.deepEqual(checkPreserved('```\ncode\n```', 'код'), ['fence']);
    assert.deepEqual(checkPreserved('a <!-- c --> b', 'а б'), ['comment']);
    assert.deepEqual(checkPreserved('*Hi* {{user}} <b>x</b>', '*Привет* {{user}} <b>икс</b>'), []);
});

test('applyGreetings replaces only accepted ids and keeps the alternates list', () => {
    const card = { first_mes: 'F', data: { first_mes: 'F', alternate_greetings: ['A', 'B', 'C'] } };
    const patch = applyGreetings(card, new Map([['first', 'Ф'], ['alt:1', 'Б']]));
    assert.equal(patch.first_mes, 'Ф');
    assert.equal(patch.data.first_mes, 'Ф');
    assert.deepEqual(patch.data.alternate_greetings, ['A', 'Б', 'C']);
});

test('applyGreetings leaves first_mes out when it is not accepted', () => {
    const patch = applyGreetings({ first_mes: 'F', data: { alternate_greetings: ['A'] } }, new Map([['alt:0', 'А']]));
    assert.equal('first_mes' in patch, false);
    assert.deepEqual(patch.data.alternate_greetings, ['А']);
});

test('buildGreetingPrompt adds the no-player rule only when writeForPlayer is false', () => {
    const items = [{ id: 'first', text: 'Hi' }];
    const rule = /never speaks, acts, thinks or feels for \{\{user\}\}/;
    assert.match(buildGreetingPrompt(items, 'ru', { writeForPlayer: false }), rule);
    assert.doesNotMatch(buildGreetingPrompt(items, 'ru', { writeForPlayer: true }), rule);
    assert.doesNotMatch(buildGreetingPrompt(items, 'ru'), rule);
});
