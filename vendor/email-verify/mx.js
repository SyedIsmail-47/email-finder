import { Resolver } from 'node:dns/promises';

/**
 * These TLDs are reserved and have no mail servers. Skipping DNS keeps
 * sample runs off the network, including Apify's build check.
 */
const RESERVED_TLDS = new Set(['invalid', 'example', 'test', 'localhost']);

/**
 * @param {string} domain
 */
export function isReservedDomain(domain) {
    const labels = domain.toLowerCase().split('.');
    return RESERVED_TLDS.has(labels[labels.length - 1] ?? '');
}

/**
 * @typedef {{
 *   found: boolean,
 *   nullMx: boolean,
 *   unreachable: boolean,
 *   timedOut: boolean,
 *   hosts: string[],
 * }} MxLookup
 */

/**
 * @param {string} domain
 * @param {{ timeoutMs: number, resolveMx?: (domain: string) => Promise<Array<{ exchange: string, priority: number }>> }} options
 * @returns {Promise<MxLookup>}
 */
export async function lookupMx(domain, { timeoutMs, resolveMx }) {
    if (isReservedDomain(domain)) return emptyMx();

    try {
        const records = await withTimeout((resolveMx ?? defaultResolveMx)(domain), timeoutMs);
        return classifyMx(records);
    } catch (error) {
        const code = error && typeof error === 'object' ? error.code : undefined;
        if (code === 'ENOTFOUND' || code === 'ENODATA' || code === 'NXDOMAIN') return emptyMx();
        return {
            found: false,
            nullMx: false,
            unreachable: true,
            timedOut: code === 'ETIMEOUT',
            hosts: [],
        };
    }
}

/**
 * One in-flight lookup per domain, then reused for the rest of the run.
 * @param {{ timeoutMs: number, resolveMx?: (domain: string) => Promise<Array<{ exchange: string, priority: number }>> }} options
 */
export function createMxLookup(options) {
    /** @type {Map<string, MxLookup>} */
    const cache = new Map();
    /** @type {Map<string, Promise<MxLookup>>} */
    const inflight = new Map();

    return function lookup(domain) {
        const key = domain.toLowerCase();
        const cached = cache.get(key);
        if (cached) return Promise.resolve(cached);
        const pending = inflight.get(key);
        if (pending) return pending;

        const promise = lookupMx(key, options).then((result) => {
            cache.set(key, result);
            inflight.delete(key);
            return result;
        }, (error) => {
            inflight.delete(key);
            throw error;
        });
        inflight.set(key, promise);
        return promise;
    };
}

/**
 * @param {Array<{ exchange?: string, priority?: number }> | undefined} records
 * @returns {MxLookup}
 */
function classifyMx(records) {
    if (!Array.isArray(records) || records.length === 0) return emptyMx();

    const hosts = records
        .map((record) => ({
            host: normalizeHost(record?.exchange),
            priority: typeof record?.priority === 'number' ? record.priority : 0,
        }))
        .filter((record) => record.host.length > 0)
        .sort((a, b) => a.priority - b.priority)
        .map((record) => record.host);

    if (hosts.length === 0) {
        return {
            found: false,
            nullMx: true,
            unreachable: false,
            timedOut: false,
            hosts: [],
        };
    }

    return {
        found: true,
        nullMx: false,
        unreachable: false,
        timedOut: false,
        hosts,
    };
}

function emptyMx() {
    return {
        found: false,
        nullMx: false,
        unreachable: false,
        timedOut: false,
        hosts: [],
    };
}

/**
 * @param {unknown} exchange
 */
function normalizeHost(exchange) {
    if (typeof exchange !== 'string') return '';
    return exchange.trim().replace(/\.$/, '').toLowerCase();
}

/** Set when the system resolver is not accepting queries, so later domains skip it. */
let skipSystemResolver = false;

/**
 * Try each resolver until one answers. A connection refusal means that
 * resolver is down, so the next one is tried. Any other error, including
 * "domain not found", is the answer and is not retried.
 * @param {string} domain
 * @param {Array<(domain: string) => Promise<Array<{ exchange: string, priority: number }>>>} resolvers
 */
export async function resolveMxRecords(domain, resolvers) {
    let lastError;
    for (let index = 0; index < resolvers.length; index += 1) {
        try {
            return await resolvers[index](domain);
        } catch (error) {
            lastError = error;
            const tryNext = error?.code === 'ECONNREFUSED' && index < resolvers.length - 1;
            if (!tryNext) throw error;
        }
    }
    throw lastError;
}

/**
 * @param {string} domain
 */
function defaultResolveMx(domain) {
    if (skipSystemResolver) return publicResolveMx(domain);
    return resolveMxRecords(domain, [
        systemResolveMx,
        (name) => {
            skipSystemResolver = true;
            return publicResolveMx(name);
        },
    ]);
}

/**
 * @param {string} domain
 */
function systemResolveMx(domain) {
    return new Resolver().resolveMx(domain);
}

/**
 * Used only when the system resolver refuses connections.
 * @param {string} domain
 */
function publicResolveMx(domain) {
    const resolver = new Resolver();
    resolver.setServers(['1.1.1.1', '8.8.8.8']);
    return resolver.resolveMx(domain);
}

/**
 * @template T
 * @param {Promise<T>} promise
 * @param {number} timeoutMs
 * @returns {Promise<T>}
 */
function withTimeout(promise, timeoutMs) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            const error = new Error('DNS lookup timed out');
            error.code = 'ETIMEOUT';
            reject(error);
        }, timeoutMs);
        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (error) => {
                clearTimeout(timer);
                reject(error);
            },
        );
    });
}
