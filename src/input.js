import { normalizeDomain } from './domain.js';
import { normalizeNamePart } from './patterns.js';

/**
 * Apply the same defaults as `.actor/input_schema.json`.
 * @param {Record<string, unknown> | null | undefined} raw
 */
export function normalizeInput(raw = {}) {
    const input = raw ?? {};
    if (!Array.isArray(input.people) || input.people.length === 0) {
        throw new Error('Input people must contain at least one person with firstName, lastName, and domain.');
    }

    return {
        people: input.people.map((item, index) => normalizePerson(item, index)),
        smtpTimeoutMs: requireInteger(input.smtpTimeoutMs, 10_000, 1_000, 120_000, 'smtpTimeoutMs'),
        maxConcurrentPerDomain: requireInteger(input.maxConcurrentPerDomain, 2, 1, 3, 'maxConcurrentPerDomain'),
        smtpProxyUrl: normalizeOptionalString(input.smtpProxyUrl),
    };
}

/**
 * @param {unknown} value
 */
function normalizeOptionalString(value) {
    if (value === undefined || value === null || value === '') return '';
    return String(value).trim();
}

/**
 * @param {unknown} item
 * @param {number} index
 */
function normalizePerson(item, index) {
    const row = index + 1;
    if (!item || typeof item !== 'object') {
        throw new Error(`Person ${row} must be an object with firstName, lastName, and domain.`);
    }
    const record = /** @type {Record<string, unknown>} */ (item);
    const firstName = String(record.firstName ?? '').trim();
    const lastName = String(record.lastName ?? '').trim();
    if (!firstName) throw new Error(`Person ${row} is missing a firstName.`);
    if (!lastName) throw new Error(`Person ${row} is missing a lastName.`);
    if (!normalizeNamePart(firstName) || !normalizeNamePart(lastName)) {
        throw new Error(`Person ${row} needs a firstName and lastName with at least one letter or digit.`);
    }
    return {
        firstName,
        lastName,
        domain: normalizeDomain(record.domain),
    };
}

function requireInteger(value, fallback, min, max, label) {
    if (value === undefined || value === null) return fallback;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
        throw new Error(`${label} must be an integer from ${min} to ${max}.`);
    }
    return value;
}
