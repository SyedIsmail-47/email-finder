/**
 * Caps how many checks run at once against a single mail domain.
 *
 * SMTP (added later) must run inside this gate, not beside it. Several
 * mail-server connections to the same domain will stall a large batch.
 * Different domains still run side by side, up to `maxParallel`.
 * The per-domain cap is hard-limited to 3 even if a caller passes more.
 */

const ABSOLUTE_MAX_PER_DOMAIN = 3;

/**
 * @param {number} maxConcurrent
 * @returns {(fn: () => Promise<unknown>) => Promise<unknown>}
 */
export function createLimiter(maxConcurrent) {
    const limit = Math.max(1, Math.trunc(maxConcurrent) || 1);
    let active = 0;
    /** @type {Array<{ fn: () => Promise<unknown>, resolve: (value: unknown) => void, reject: (error: unknown) => void }>} */
    const queue = [];

    function drain() {
        while (active < limit && queue.length > 0) {
            const job = queue.shift();
            active += 1;
            Promise.resolve()
                .then(job.fn)
                .then(job.resolve, job.reject)
                .finally(() => {
                    active -= 1;
                    drain();
                });
        }
    }

    return function limitRun(fn) {
        return new Promise((resolve, reject) => {
            queue.push({ fn, resolve, reject });
            drain();
        });
    };
}

/**
 * @param {number} maxConcurrent
 * @returns {(domain: string, fn: () => Promise<unknown>) => Promise<unknown>}
 */
export function createDomainGate(maxConcurrent) {
    const perDomain = Math.min(
        ABSOLUTE_MAX_PER_DOMAIN,
        Math.max(1, Math.trunc(maxConcurrent) || 1),
    );
    /** @type {Map<string, ReturnType<typeof createLimiter>>} */
    const limiters = new Map();

    return function run(domain, fn) {
        const key = String(domain).toLowerCase();
        let limit = limiters.get(key);
        if (!limit) {
            limit = createLimiter(perDomain);
            limiters.set(key, limit);
        }
        return limit(fn);
    };
}
