// Errors the user can act on. Our own failures are thrown as LocalizerError with a code; errors from
// SillyTavern and the providers are plain Errors with the provider's text (often wrapped as
// 'API request failed' with a cause), so they are recognized by that text.
// The message stays English; errorText() translates it with SillyTavern's translate() for display.

// English texts double as translation keys in i18n/ru-ru.json; ${0}, ${1} are filled from `values`.
const USER_MESSAGES = {
    // API & connection
    'RATE_LIMIT': 'Rate limit reached. Wait a few minutes and try again.',
    'INVALID_KEY': 'The service did not accept the API key. Check the key in the connection settings.',
    'INSUFFICIENT_QUOTA': 'The account has run out of credits or quota. Check its balance or plan.',
    'MODEL_NOT_FOUND': 'The service does not know this model. Load the model list and pick another one.',
    'MODEL_OVERLOADED': 'The model is overloaded. Try again in a few minutes.',
    'NETWORK_TIMEOUT': 'The request timed out. Check the connection and try again.',
    'NETWORK_ERROR': 'Could not reach the service. Check the address and the internet connection.',
    'SERVER_ERROR': 'The AI service is having problems (${0}). Try again later.',
    'MODELS_NOT_LOADED': 'Could not load models (HTTP ${0}).',
    'MODELS_REFUSED': 'Could not load models: the service refused the request (check the key).',

    // Model reply
    'EMPTY_RESPONSE': 'The model returned an empty reply.',
    'REASONING_OVERFLOW': 'The model spent its whole token limit on reasoning and gave no answer. Turn reasoning off for this model, pick a model without reasoning, or lower "Entries per request".',
    'CONTEXT_LENGTH_EXCEEDED': 'The request is too long for this model. Lower "Entries per request" or pick a model with a larger context.',
    'CONTENT_POLICY': 'The provider blocked the request with its content filter. Try another model or provider for these entries.',

    // Settings & files
    'NO_MODEL': 'Choose a model for your service.',
    'NO_SERVICE_URL': 'Enter the service URL.',
    'INVALID_API_KEY': 'The API key contains invalid characters.',
    'PROFILE_NOT_FOUND': 'The selected connection profile no longer exists.',
    'LOREBOOK_NOT_FOUND': 'Lorebook "${0}" not found.',
    'BACKUP_NOT_FOUND': 'Backup file not found.',
    'BACKUP_CORRUPTED': 'Backup is empty or damaged.',
    'NOT_A_BACKUP': 'This is not a backup lorebook.',
    'NO_BACKUPS': 'No backups yet.',
};

// Retrying cannot help and every other batch would fail the same way: stop the whole run.
const FATAL = new Set(['INVALID_KEY', 'INSUFFICIENT_QUOTA', 'MODEL_NOT_FOUND', 'PROFILE_NOT_FOUND', 'REASONING_OVERFLOW', 'NO_MODEL', 'NO_SERVICE_URL', 'INVALID_API_KEY']);
// Retrying the same request cannot help, but other batches may still pass.
const NO_RETRY = new Set(['CONTENT_POLICY', 'CONTEXT_LENGTH_EXCEEDED']);

export class LocalizerError extends Error {
    /**
     * @param {keyof USER_MESSAGES} code
     * @param {(string|number)[]} [values] fill ${0}, ${1}, … of the message
     * @param {unknown} [cause] the original error, kept for the console
     */
    constructor(code, values = [], cause = undefined) {
        super(fill(USER_MESSAGES[code] ?? code, values), cause === undefined ? undefined : { cause });
        this.name = 'LocalizerError';
        this.code = code;
        this.values = values;
        this.fatal = FATAL.has(code);
        this.retryable = !this.fatal && !NO_RETRY.has(code);
    }
}

function fill(template, values) {
    return template.replace(/\$\{(\d+)\}/g, (match, i) => (values[i] === undefined ? match : String(values[i])));
}

/** Provider texts → codes. Checked in order on the lowercased text of the error and its causes. */
const PATTERNS = [
    ['INSUFFICIENT_QUOTA', /insufficient[_ ](quota|balance|credits?|funds)|exceeded your current quota|quota exceeded|payment required|out of credits|\b402\b/],
    ['RATE_LIMIT', /rate[_ -]?limit|too many requests|\b429\b|resource[_ ]exhausted/],
    ['INVALID_KEY', /api[_ ]?key.{0,30}(invalid|incorrect|not valid|not set|expired|missing)|(invalid|incorrect|missing).{0,20}(api[_ ]?key|token|credentials)|unauthori[sz]ed|authentication|\b401\b|\b403\b|permission denied/],
    ['CONTEXT_LENGTH_EXCEEDED', /context[_ ]length|maximum context|context window|prompt is too long|too many (input )?tokens|reduce the length/],
    ['MODEL_NOT_FOUND', /model.{0,80}(not found|does not exist|doesn't exist|not exist|is not available|unknown|not supported|invalid)|(unknown|invalid|no such) model|no endpoints found/],
    ['CONTENT_POLICY', /content[_ ]?(policy|filter|management)|moderation|flagged|safety|prohibited|harm[_ ]?category|data_inspection_failed|inappropriate/],
    ['MODEL_OVERLOADED', /overloaded|over capacity|at capacity|\b529\b/],
    ['NETWORK_TIMEOUT', /timed? ?out|timeout|\b504\b|\b524\b/],
    ['NETWORK_ERROR', /failed to fetch|networkerror|network error|econnrefused|econnreset|enotfound|getaddrinfo|socket hang up/],
];

function rawText(error) {
    const parts = [];
    for (let e = error, depth = 0; e && depth < 5; e = e.cause, depth++) {
        parts.push(typeof e === 'string' ? e : e.message ?? '');
        if (typeof e !== 'object') break;
    }
    return parts.filter(Boolean).join(' — ');
}

/**
 * The error as a LocalizerError when it is recognized; otherwise unchanged (aborts included).
 * @param {unknown} error
 * @returns {unknown}
 */
export function classify(error) {
    if (error instanceof LocalizerError || error?.name === 'AbortError') return error;
    const text = rawText(error).toLowerCase();
    for (const [code, pattern] of PATTERNS) if (pattern.test(text)) return new LocalizerError(code, [], error);
    const status = text.match(/\b(5\d\d)\b/)?.[1] ?? text.match(/\bservice unavailable|bad gateway|internal server error\b/)?.[0];
    if (status) return new LocalizerError('SERVER_ERROR', [status], error);
    return error;
}

/**
 * Text to show the user. A recognized error gets its translated explanation; an unknown one keeps
 * the provider's own text (with the cause SillyTavern wraps it in), since that is all we know.
 * @param {unknown} error
 * @param {(text: string) => string} [translate] SillyTavern's translate()
 */
export function errorText(error, translate = text => text) {
    const known = classify(error);
    if (known instanceof LocalizerError) return fill(translate(USER_MESSAGES[known.code]), known.values);
    return rawText(error) || String(error);
}

export { USER_MESSAGES };
