// SillyTavern model adapter. Three ways to reach a model:
//  current — generateRaw({ prompt, responseLength }) (public/script.js) with the active connection;
//            returns a string and takes no AbortSignal: Cancel stops waiting at once (untilAborted).
//  profile — ConnectionManagerRequestService.sendRequest(profileId, prompt, maxTokens, { signal },
//            overridePayload) (public/scripts/extensions/shared.js); overridePayload.model replaces the
//            profile's model. Returns { content } and wraps errors as 'API request failed'.
//  custom  — ChatCompletionService.processRequest({ ...payload }, {}, true, signal) with the "custom"
//            source: the user's own URL and key, sent through SillyTavern's server.
// Model lists come from POST /api/backends/chat-completions/status, which answers with the
// source's /models list using the keys SillyTavern already stores (or the custom header).
import { customRequestFields, modelListBody } from './providers.js';
import { LocalizerError, classify } from './errors.js';

const DEFAULT_MAX_TOKENS = 4096;

/**
 * Text of a model reply. Reasoning models return { content, reasoning }; when the reasoning uses
 * up max_tokens, content comes back empty.
 * @param {string | { content?: string, reasoning?: string }} result
 * @returns {string}
 */
export function replyText(result) {
    const content = typeof result === 'string' ? result : result?.content ?? '';
    if (content.trim()) return content;
    if (typeof result === 'object' && String(result?.reasoning ?? '').trim()) {
        // Retrying the same request only burns the same tokens again: stop the whole run.
        throw new LocalizerError('REASONING_OVERFLOW');
    }
    throw new LocalizerError('EMPTY_RESPONSE');
}
const ctx = () => SillyTavern.getContext();

/**
 * Resolves like `promise`, or rejects with an AbortError as soon as `signal` aborts.
 * @template T
 * @param {Promise<T>} promise
 * @param {AbortSignal} [signal]
 * @returns {Promise<T>}
 */
export function untilAborted(promise, signal) {
    if (!signal) return promise;
    const aborted = () => new DOMException('Aborted', 'AbortError');
    if (signal.aborted) {
        promise.catch(() => {}); // the late result is not wanted
        return Promise.reject(aborted());
    }
    return new Promise((resolve, reject) => {
        const onAbort = () => reject(aborted());
        signal.addEventListener('abort', onAbort, { once: true });
        promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
    });
}

/**
 * For "current connection": SillyTavern copies the user's reasoning effort into every chat completion
 * request. Drop it from our request only, so the model runs with its provider default.
 * @param {{ messages?: { content?: string }[], reasoning_effort?: string }} data generate_data from CHAT_COMPLETION_SETTINGS_READY
 * @param {string} prompt our prompt text
 */
export function stripReasoning(data, prompt) {
    if (data?.messages?.some(m => m?.content === prompt)) delete data.reasoning_effort;
}

/** @returns {{ id: string, name: string }[]} empty when Connection Manager is disabled */
export function listProfiles() {
    try {
        return ctx().ConnectionManagerRequestService.getSupportedProfiles().map(p => ({ id: p.id, name: p.name }));
    } catch {
        return [];
    }
}

function getProfile(profileId) {
    try {
        return ctx().ConnectionManagerRequestService.getProfile(profileId);
    } catch {
        return null;
    }
}

/** The model a connection uses when the user picked none. */
export function defaultModel(conn) {
    return conn.mode === 'profile' ? getProfile(conn.profileId)?.model ?? '' : '';
}

/**
 * Models the connection can use, sorted by id. Empty when the source cannot list them.
 * @param {{ mode: string, profileId?: string, providerId?: string, url?: string, key?: string }} conn
 * @returns {Promise<string[]>}
 */
export async function listModels(conn) {
    const body = modelListBody(conn, conn.mode === 'profile' ? getProfile(conn.profileId) : null);
    if (!body) return [];
    const response = await fetch('/api/backends/chat-completions/status', {
        method: 'POST',
        headers: ctx().getRequestHeaders(),
        body: JSON.stringify(body),
    });
    if (!response.ok) throw new LocalizerError('MODELS_NOT_LOADED', [response.status]);
    const data = await response.json();
    if (data?.error) throw new LocalizerError('MODELS_REFUSED');
    const list = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : Array.isArray(data) ? data : [];
    return [...new Set(list.map(m => (typeof m === 'string' ? m : m?.id ?? m?.name)).filter(Boolean))].sort();
}

/**
 * @param {{ mode: 'current'|'profile'|'custom', profileId?: string, model?: string, providerId?: string, url?: string, key?: string }} conn
 * @returns {{ send: (prompt: string, signal?: AbortSignal, maxTokens?: number) => Promise<string>, modelId: string }}
 */
export function createLlm(conn) {
    const llm = createRawLlm(conn);
    const send = llm.send;
    // Provider errors become LocalizerErrors, so a wrong key or an empty balance is not retried.
    llm.send = async (...args) => {
        try {
            return await send(...args);
        } catch (error) {
            throw classify(error);
        }
    };
    return llm;
}

function createRawLlm(conn) {
    const messages = prompt => [{ role: 'user', content: prompt }];

    if (conn.mode === 'profile') {
        const service = ctx().ConnectionManagerRequestService;
        const profile = getProfile(conn.profileId);
        if (!profile) throw new LocalizerError('PROFILE_NOT_FOUND');
        const model = conn.model || profile.model;
        return {
            modelId: model || profile.name,
            async send(prompt, signal, maxTokens = DEFAULT_MAX_TOKENS) {
                const input = service.constructPrompt(messages(prompt), conn.profileId);
                const override = conn.model ? { model: conn.model } : {};
                // includePreset: false — a roleplay preset's samplers and reasoning settings do not belong in
                // this utility request (a preset with reasoning on made DeepSeek burn the whole limit thinking).
                const result = await service.sendRequest(conn.profileId, input, maxTokens, { stream: false, signal, includePreset: false }, override);
                return replyText(result);
            },
        };
    }

    if (conn.mode === 'custom') {
        if (!conn.model) throw new LocalizerError('NO_MODEL');
        const fields = customRequestFields(conn);
        return {
            modelId: conn.model,
            async send(prompt, signal, maxTokens = DEFAULT_MAX_TOKENS) {
                const result = await ctx().ChatCompletionService.processRequest(
                    { stream: false, messages: messages(prompt), max_tokens: maxTokens, model: conn.model, ...fields },
                    {},
                    true,
                    signal,
                );
                return replyText(result);
            },
        };
    }

    return {
        modelId: 'current',
        async send(prompt, signal, maxTokens = DEFAULT_MAX_TOKENS) {
            const { eventSource, eventTypes } = ctx();
            const hook = data => stripReasoning(data, prompt.trim());
            eventSource.on(eventTypes.CHAT_COMPLETION_SETTINGS_READY, hook);
            try {
                // generateRaw takes no AbortSignal: on Cancel stop waiting at once and ignore the late reply,
                // so a hung service does not keep the panel locked.
                return replyText(await untilAborted(ctx().generateRaw({ prompt, responseLength: maxTokens }), signal));
            } finally {
                eventSource.removeListener(eventTypes.CHAT_COMPLETION_SETTINGS_READY, hook);
            }
        },
    };
}
