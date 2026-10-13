import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LocalizerError, classify, errorText } from '../src/errors.js';

const wrapped = text => new Error('API request failed', { cause: new Error(text) });

test('provider texts are recognized, also inside the cause SillyTavern wraps them in', () => {
    assert.equal(classify(wrapped('Incorrect API key provided: sk-…')).code, 'INVALID_KEY');
    assert.equal(classify(new Error('You exceeded your current quota')).code, 'INSUFFICIENT_QUOTA');
    assert.equal(classify(new Error('Rate limit exceeded: free-models-per-day')).code, 'RATE_LIMIT');
    assert.equal(classify(new Error("This model's maximum context length is 8192 tokens")).code, 'CONTEXT_LENGTH_EXCEEDED');
    assert.equal(classify(new Error('The model `gpt-9` does not exist')).code, 'MODEL_NOT_FOUND');
    assert.equal(classify(new Error('Got response status 502')).code, 'SERVER_ERROR');
});

test('a wrong key stops the run; a rate limit is retried; a content filter is not retried', () => {
    assert.equal(classify(wrapped('401 Unauthorized')).fatal, true);
    assert.equal(classify(new Error('429 Too Many Requests')).retryable, true);
    const blocked = classify(new Error('Response was flagged by moderation'));
    assert.equal(blocked.retryable, false);
    assert.equal(blocked.fatal, false);
});

test('unknown errors keep the provider text; known ones are translated', () => {
    assert.equal(errorText(wrapped('weird thing')), 'API request failed — weird thing');
    assert.equal(errorText(new LocalizerError('LOREBOOK_NOT_FOUND', ['Ауры']), s => s.replace('Lorebook', 'Лорбук')), 'Лорбук "Ауры" not found.');
    const abort = new DOMException('Aborted', 'AbortError');
    assert.equal(classify(abort), abort);
});
