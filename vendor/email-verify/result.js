/** Status values every checked address must use. */
export const STATUS = Object.freeze({
    valid: 'valid',
    invalid: 'invalid',
    risky: 'risky',
    disposable: 'disposable',
    unknown: 'unknown',
});

export const REASON = Object.freeze({
    malformed: 'Malformed email address',
    noMx: 'No MX records for this domain',
    nullMx: 'Domain does not accept email',
    dnsTimeout: 'Domain lookup timed out',
    dnsFailed: 'Domain lookup failed',
    disposable: 'Disposable email domain',
    mailboxAccepted: 'Mailbox accepted',
    mailboxRejected: 'Mailbox rejected by the mail server',
    smtpTemporary: 'Temporary server response, not a real rejection',
    smtpTimeout: 'SMTP connection timed out',
    smtpUnreachable: 'Mail server could not be reached',
    catchAll: 'catch-all domain',
    blanketReject: 'indeterminate — server may reject all unverified addresses uniformly.',
    checkFailed: 'Check failed before a status could be determined',
});

/** Statuses that consume one email-checked event. unknown is saved and not charged. */
const CHARGEABLE_STATUSES = new Set([
    STATUS.valid,
    STATUS.invalid,
    STATUS.risky,
    STATUS.disposable,
]);

/**
 * @param {string} status
 */
export function shouldChargeForStatus(status) {
    return CHARGEABLE_STATUSES.has(status);
}

/**
 * One dataset record. Every field is always present.
 * @param {{
 *   email: string,
 *   status: string,
 *   reason: string,
 *   isDisposable: boolean,
 *   isRoleAccount: boolean,
 *   isCatchAll: boolean,
 *   possibleBlanketReject: boolean,
 *   mxRecordFound: boolean,
 *   checkedAt: string,
 * }} fields
 */
export function buildResult(fields) {
    return {
        email: fields.email,
        status: fields.status,
        reason: fields.reason,
        isDisposable: fields.isDisposable,
        isRoleAccount: fields.isRoleAccount,
        isCatchAll: fields.isCatchAll,
        possibleBlanketReject: fields.possibleBlanketReject,
        mxRecordFound: fields.mxRecordFound,
        checkedAt: fields.checkedAt,
    };
}
