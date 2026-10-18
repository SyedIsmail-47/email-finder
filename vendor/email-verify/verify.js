import { createDomainGate, createLimiter } from './domainGate.js';
import { isDisposableDomain } from './disposable.js';
import { REASON, STATUS, buildResult } from './result.js';
import { isRoleLocalPart } from './role.js';
import { probeMailbox } from './smtp.js';
import { parseEmail } from './syntax.js';

/** How many different domains may be in flight at once. Per-domain cap is separate. */
const DEFAULT_PARALLEL_DOMAINS = 50;

/**
 * Syntax, MX, disposable/role, then SMTP. Stop at the first decided status.
 * Role-account detection only sets a flag.
 *
 * The SMTP handshake and the catch-all probe run in this function, so
 * they share the per-domain slot the caller already holds. Do not acquire
 * that gate again here, and do not open a second connection for the probe.
 *
 * @param {unknown} email
 * @param {{
 *   lookupMx: (domain: string) => Promise<import('./mx.js').MxLookup>,
 *   disposableDomains: Set<string>,
 *   checkRoleAccounts: boolean,
 *   checkCatchAll?: boolean,
 *   smtpTimeoutMs?: number,
 *   probeMailbox?: typeof probeMailbox,
 *   proxyUrl?: string | null,
 *   getProxyUrl?: () => string | Promise<string | null | undefined>,
 * }} options
 */
export async function verifyEmail(email, options) {
    const checkedAt = new Date().toISOString();
    const parsed = parseEmail(email);
    if (!parsed.ok) {
        return buildResult({
            email: parsed.email,
            status: STATUS.invalid,
            reason: REASON.malformed,
            isDisposable: false,
            isRoleAccount: false,
            isCatchAll: false,
            possibleBlanketReject: false,
            mxRecordFound: false,
            checkedAt,
        });
    }

    const isRoleAccount = options.checkRoleAccounts && isRoleLocalPart(parsed.local);
    const isDisposable = isDisposableDomain(parsed.domain, options.disposableDomains);

    const finish = (status, reason, mxRecordFound, isCatchAll = false, possibleBlanketReject = false) => buildResult({
        email: parsed.email,
        status,
        reason,
        isDisposable,
        isRoleAccount,
        isCatchAll,
        possibleBlanketReject,
        mxRecordFound,
        checkedAt,
    });

    let mx;
    try {
        mx = await options.lookupMx(parsed.domain);
    } catch {
        return finish(STATUS.unknown, REASON.checkFailed, false);
    }

    if (mx.unreachable) {
        return finish(
            STATUS.unknown,
            mx.timedOut ? REASON.dnsTimeout : REASON.dnsFailed,
            false,
        );
    }
    if (mx.nullMx) return finish(STATUS.invalid, REASON.nullMx, false);
    if (!mx.found) return finish(STATUS.invalid, REASON.noMx, false);
    if (isDisposable) return finish(STATUS.disposable, REASON.disposable, true);

    let smtp;
    try {
        smtp = await (options.probeMailbox ?? probeMailbox)({
            hosts: mx.hosts,
            email: parsed.email,
            domain: parsed.domain,
            timeoutMs: options.smtpTimeoutMs ?? 10_000,
            checkCatchAll: options.checkCatchAll !== false,
            proxyUrl: options.proxyUrl,
            getProxyUrl: options.getProxyUrl,
        });
    } catch {
        return finish(STATUS.unknown, REASON.checkFailed, true);
    }

    if (smtp.outcome === 'temporary') return finish(STATUS.unknown, REASON.smtpTemporary, true);
    if (smtp.blanketReject) return finish(STATUS.unknown, REASON.blanketReject, true, false, true);
    if (smtp.outcome === 'rejected') return finish(STATUS.invalid, REASON.mailboxRejected, true);
    if (smtp.outcome !== 'accepted') {
        return finish(
            STATUS.unknown,
            smtp.timedOut ? REASON.smtpTimeout : REASON.smtpUnreachable,
            true,
        );
    }
    if (smtp.catchAll) return finish(STATUS.risky, REASON.catchAll, true, true);
    return finish(STATUS.valid, REASON.mailboxAccepted, true);
}

/**
 * Check every address. One thrown check becomes status "unknown" and
 * does not cancel the rest. Results stay in input order.
 *
 * @param {string[]} emails
 * @param {{
 *   lookupMx: (domain: string) => Promise<import('./mx.js').MxLookup>,
 *   disposableDomains: Set<string>,
 *   checkRoleAccounts: boolean,
 *   checkCatchAll?: boolean,
 *   smtpTimeoutMs?: number,
 *   probeMailbox?: typeof probeMailbox,
 *   maxConcurrentPerDomain: number,
 *   maxParallelDomains?: number,
 * }} options
 */
export async function verifyEmails(emails, options) {
    const gate = createDomainGate(options.maxConcurrentPerDomain);
    const globalLimit = createLimiter(options.maxParallelDomains ?? DEFAULT_PARALLEL_DOMAINS);
    const results = new Array(emails.length);

    await Promise.all(emails.map((email, index) => {
        const parsed = parseEmail(email);
        const check = () => globalLimit(async () => {
            try {
                return await verifyEmail(email, options);
            } catch {
                return buildResult({
                    email: typeof email === 'string' ? email.trim() : String(email ?? ''),
                    status: STATUS.unknown,
                    reason: REASON.checkFailed,
                    isDisposable: false,
                    isRoleAccount: false,
                    isCatchAll: false,
                    possibleBlanketReject: false,
                    mxRecordFound: false,
                    checkedAt: new Date().toISOString(),
                });
            }
        });
        // Take the per-domain slot first. Waiting on a busy domain must
        // not occupy a global slot, or one large domain blocks every other.
        const run = parsed.ok ? gate(parsed.domain, check) : check();
        return run.then((result) => {
            results[index] = result;
        });
    }));

    return results;
}
