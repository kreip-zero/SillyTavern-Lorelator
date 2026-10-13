const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function abortError() {
    return new DOMException('Aborted', 'AbortError');
}

/**
 * Run `fn`, retrying failures with exponential backoff (baseMs, 2*baseMs, ...).
 * Aborts are never retried.
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{ attempts?: number, baseMs?: number, signal?: AbortSignal, sleep?: (ms: number) => Promise<void> }} [options]
 * @returns {Promise<T>}
 */
export async function withRetry(fn, { attempts = 3, baseMs = 1000, signal, sleep = defaultSleep } = {}) {
    for (let i = 0; ; i++) {
        if (signal?.aborted) throw abortError();
        try {
            return await fn();
        } catch (error) {
            if (error?.name === 'AbortError' || signal?.aborted) throw signal?.aborted ? abortError() : error;
            if (error?.retryable === false) throw error;
            if (i >= attempts - 1) throw error;
            await sleep(baseMs * 2 ** i);
        }
    }
}
