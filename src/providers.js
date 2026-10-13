import { LocalizerError } from './errors.js';
// OpenAI-compatible services for the "own service and key" connection. Requests go through
// SillyTavern's server as its "custom" Chat Completion source, so no CORS and no key in the URL.
// Base URLs checked against each provider's docs (2026-10).
export const PROVIDERS = [
    { id: 'openrouter', name: 'OpenRouter', url: 'https://openrouter.ai/api/v1' },
    { id: 'nanogpt', name: 'NanoGPT', url: 'https://nano-gpt.com/api/v1' },
    { id: 'deepseek', name: 'DeepSeek', url: 'https://api.deepseek.com' },
    { id: 'qwen', name: 'Qwen (Alibaba Cloud)', url: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1' },
    { id: 'zai', name: 'GLM (Z.ai)', url: 'https://api.z.ai/api/paas/v4' },
    { id: 'moonshot', name: 'Kimi (Moonshot)', url: 'https://api.moonshot.ai/v1' },
    { id: 'openai', name: 'OpenAI', url: 'https://api.openai.com/v1' },
    { id: 'mistral', name: 'Mistral', url: 'https://api.mistral.ai/v1' },
    { id: 'groq', name: 'Groq', url: 'https://api.groq.com/openai/v1' },
    { id: 'custom', name: 'Other (OpenAI-compatible)', url: '' },
];

function baseUrl(providerId, url) {
    const preset = PROVIDERS.find(p => p.id === providerId);
    if (preset && preset.id !== 'custom') return preset.url;
    const cleaned = String(url ?? '').trim().replace(/\/+$/, '').replace(/\/chat\/completions$/, '').replace(/\/+$/, '');
    if (!cleaned) throw new LocalizerError('NO_SERVICE_URL');
    return cleaned;
}

function authHeader(key) {
    const trimmed = String(key ?? '').trim();
    if (!trimmed) return '';
    // The header block is YAML; a line break would let the key inject other headers.
    if (/[\r\n\u0000-\u001f]/.test(trimmed)) throw new LocalizerError('INVALID_API_KEY');
    return `Authorization: ${JSON.stringify(`Bearer ${trimmed}`)}`;
}

/**
 * Request fields for SillyTavern's "custom" Chat Completion source.
 * @param {{ providerId: string, url?: string, key?: string }} conn
 * @returns {{ chat_completion_source: 'custom', custom_url: string, custom_include_headers: string }}
 */
export function customRequestFields({ providerId, url, key }) {
    return {
        chat_completion_source: 'custom',
        custom_url: baseUrl(providerId, url),
        custom_include_headers: authHeader(key),
    };
}

/**
 * Body for POST /api/backends/chat-completions/status, which lists a source's models.
 * @param {{ mode: string, providerId?: string, url?: string, key?: string }} conn
 * @param {object} [profile] Connection Manager profile (for mode 'profile')
 * @returns {object | null} null when the source cannot list models (text completion profiles)
 */
export function modelListBody(conn, profile) {
    if (conn.mode === 'custom') return customRequestFields(conn);
    if (conn.mode !== 'profile' || !profile || profile.mode === 'tc') return null;
    const body = { chat_completion_source: profile.api };
    if (profile['api-url']) body.custom_url = profile['api-url'];
    if (profile['secret-id']) body.secret_id = profile['secret-id'];
    return body;
}
