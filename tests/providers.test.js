import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDERS, customRequestFields, modelListBody } from '../src/providers.js';

test('presets cover the agreed services and all are https', () => {
    const ids = PROVIDERS.map(p => p.id);
    for (const id of ['openrouter', 'nanogpt', 'deepseek', 'qwen', 'zai', 'moonshot', 'openai', 'mistral', 'groq', 'custom']) assert.ok(ids.includes(id), id);
    for (const p of PROVIDERS.filter(p => p.id !== 'custom')) assert.match(p.url, /^https:\/\//);
});

test('preset provider uses its own URL and a bearer header', () => {
    const f = customRequestFields({ providerId: 'deepseek', url: 'https://ignored', key: '  sk-abc  ' });
    assert.equal(f.chat_completion_source, 'custom');
    assert.equal(f.custom_url, 'https://api.deepseek.com');
    assert.equal(f.custom_include_headers, 'Authorization: "Bearer sk-abc"');
});

test('custom URL is cleaned of trailing slash and endpoint path', () => {
    assert.equal(customRequestFields({ providerId: 'custom', url: 'http://localhost:1234/v1/chat/completions/', key: '' }).custom_url, 'http://localhost:1234/v1');
    assert.equal(customRequestFields({ providerId: 'custom', url: 'http://localhost:1234/v1/', key: '' }).custom_url, 'http://localhost:1234/v1');
});

test('empty key sends no auth header (local servers)', () => {
    assert.equal(customRequestFields({ providerId: 'custom', url: 'http://localhost:1234/v1', key: '' }).custom_include_headers, '');
});

test('keys with quotes or colons stay one YAML value; line breaks are rejected', () => {
    const f = customRequestFields({ providerId: 'openai', key: 'a:b#"c' });
    assert.equal(f.custom_include_headers, 'Authorization: "Bearer a:b#\\"c"');
    assert.throws(() => customRequestFields({ providerId: 'openai', key: 'abc\nX-Evil: 1' }), /key/i);
});

test('custom provider without URL is an error', () => {
    assert.throws(() => customRequestFields({ providerId: 'custom', url: '  ', key: 'k' }), /URL/);
});

test('model list request for a profile uses its source and URL', () => {
    assert.deepEqual(modelListBody({ mode: 'profile' }, { api: 'nanogpt' }), { chat_completion_source: 'nanogpt' });
    assert.deepEqual(modelListBody({ mode: 'profile' }, { api: 'custom', 'api-url': 'http://x/v1' }), { chat_completion_source: 'custom', custom_url: 'http://x/v1' });
    assert.equal(modelListBody({ mode: 'profile' }, { mode: 'tc', api: 'koboldcpp' }), null);
    assert.deepEqual(modelListBody({ mode: 'profile' }, { api: 'nanogpt', 'secret-id': 's1' }), { chat_completion_source: 'nanogpt', secret_id: 's1' });
});

test('model list request for own service carries the key header', () => {
    const body = modelListBody({ mode: 'custom', providerId: 'openrouter', key: 'k' });
    assert.equal(body.custom_url, 'https://openrouter.ai/api/v1');
    assert.equal(body.custom_include_headers, 'Authorization: "Bearer k"');
});
