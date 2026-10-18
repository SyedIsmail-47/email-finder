import { createDomainGate } from '../vendor/email-verify/domainGate.js';
import { loadDisposableDomains } from '../vendor/email-verify/disposable.js';
import { createMxLookup } from '../vendor/email-verify/mx.js';
import { STATUS } from '../vendor/email-verify/result.js';
import { verifyEmail } from '../vendor/email-verify/verify.js';
import { generateCandidates } from './patterns.js';

export const EMAIL_STATUS = Object.freeze({
    valid: 'valid',
    risky: 'risky',
    not_found: 'not_found',
    unknown: 'unknown',
});

/**
 * Shared verifier deps for one Actor run (one domain gate for every person).
 * @param {{
 *   maxConcurrentPerDomain?: number,
 *   smtpTimeoutMs?: number,
 *   checkCatchAll?: boolean,
 *   checkRoleAccounts?: boolean,
 *   verifyEmail?: typeof verifyEmail,
 *   lookupMx?: (domain: string) => Promise<import('../vendor/email-verify/mx.js').MxLookup>,
 *   disposableDomains?: Set<string>,
 *   probeMailbox?: unknown,
 *   getProxyUrl?: () => string | Promise<string | null | undefined>,
 * }} [options]
 */
export function createEmailFinder(options = {}) {
    const maxConcurrentPerDomain = options.maxConcurrentPerDomain ?? 2;
    const smtpTimeoutMs = options.smtpTimeoutMs ?? 10_000;
    const gate = createDomainGate(maxConcurrentPerDomain);
    const lookupMx = options.lookupMx ?? createMxLookup({ timeoutMs: smtpTimeoutMs });
    const disposableDomains = options.disposableDomains ?? loadDisposableDomains();
    const verify = options.verifyEmail ?? verifyEmail;

    return {
        gate,
        maxConcurrentPerDomain,
        /**
         * @param {{ firstName: string, lastName: string, domain: string }} person
         * @param {{ log?: { info: Function, warning: Function } }} [runOptions]
         */
        async findEmail(person, runOptions = {}) {
            return findEmailForPerson(person, {
                gate,
                verifyEmail: verify,
                lookupMx,
                disposableDomains,
                smtpTimeoutMs,
                checkCatchAll: options.checkCatchAll !== false,
                checkRoleAccounts: options.checkRoleAccounts !== false,
                probeMailbox: options.probeMailbox,
                getProxyUrl: options.getProxyUrl,
                log: runOptions.log,
            });
        },
    };
}

/**
 * Try name patterns in order. Stop at the first valid. If none are valid, keep
 * the first risky. Otherwise not_found or unknown.
 * @param {{ firstName: string, lastName: string, domain: string }} person
 * @param {{
 *   gate: (domain: string, fn: () => Promise<unknown>) => Promise<unknown>,
 *   verifyEmail: typeof verifyEmail,
 *   lookupMx: (domain: string) => Promise<import('../vendor/email-verify/mx.js').MxLookup>,
 *   disposableDomains: Set<string>,
 *   smtpTimeoutMs?: number,
 *   checkCatchAll?: boolean,
 *   checkRoleAccounts?: boolean,
 *   probeMailbox?: unknown,
 *   getProxyUrl?: () => string | Promise<string | null | undefined>,
 *   log?: { info: Function, warning: Function },
 * }} options
 */
export async function findEmailForPerson(person, options) {
    const log = options.log;
    const candidates = generateCandidates(person);
    /** @type {{ foundEmail: string, emailStatus: string, patternUsed: string, reason: string } | null} */
    let firstRisky = null;
    let sawUnknown = false;
    let checks = 0;

    for (const candidate of candidates) {
        checks += 1;
        const result = /** @type {{ email: string, status: string, reason: string }} */ (
            await options.gate(person.domain, () => options.verifyEmail(candidate.email, {
                lookupMx: options.lookupMx,
                disposableDomains: options.disposableDomains,
                checkRoleAccounts: options.checkRoleAccounts !== false,
                checkCatchAll: options.checkCatchAll !== false,
                smtpTimeoutMs: options.smtpTimeoutMs ?? 10_000,
                probeMailbox: options.probeMailbox,
                getProxyUrl: options.getProxyUrl,
            }))
        );

        log?.info?.(
            `${person.firstName} ${person.lastName}: ${candidate.email} → ${result.status} (${result.reason})`,
        );

        if (result.status === STATUS.valid) {
            return {
                foundEmail: result.email,
                emailStatus: EMAIL_STATUS.valid,
                patternUsed: candidate.pattern,
                reason: result.reason,
                checks,
            };
        }

        if (result.status === STATUS.risky && !firstRisky) {
            firstRisky = {
                foundEmail: result.email,
                emailStatus: EMAIL_STATUS.risky,
                patternUsed: candidate.pattern,
                reason: result.reason,
            };
            continue;
        }

        if (result.status === STATUS.unknown) {
            sawUnknown = true;
        }
    }

    if (firstRisky) {
        return {
            foundEmail: firstRisky.foundEmail,
            emailStatus: EMAIL_STATUS.risky,
            patternUsed: firstRisky.patternUsed,
            reason: firstRisky.reason,
            checks,
        };
    }

    return {
        foundEmail: null,
        emailStatus: sawUnknown ? EMAIL_STATUS.unknown : EMAIL_STATUS.not_found,
        patternUsed: '',
        reason: sawUnknown
            ? 'No candidate returned valid or risky; at least one check was unknown.'
            : 'No candidate returned valid or risky.',
        checks,
    };
}
