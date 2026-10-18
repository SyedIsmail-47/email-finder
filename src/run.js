import { Actor, log } from 'apify';

import { createEmailFinder } from './find.js';

/**
 * Generate name-based candidates for each person and verify them through the
 * vendored bulk-email-verifier engine. One shared per-domain gate for the run.
 * @param {ReturnType<import('./input.js').normalizeInput>} input
 */
export async function runEmailFinder(input) {
    const finder = createEmailFinder({
        maxConcurrentPerDomain: input.maxConcurrentPerDomain,
        smtpTimeoutMs: input.smtpTimeoutMs,
        checkCatchAll: true,
        checkRoleAccounts: true,
    });

    for (const person of input.people) {
        log.info(`Finding email for ${person.firstName} ${person.lastName} @ ${person.domain}`);
        const result = await finder.findEmail(person, { log });

        const record = {
            firstName: person.firstName,
            lastName: person.lastName,
            domain: person.domain,
            foundEmail: result.foundEmail,
            emailStatus: result.emailStatus,
            patternUsed: result.patternUsed,
        };

        log.info(
            `${person.firstName} ${person.lastName}: ${record.emailStatus}`
            + (record.foundEmail ? ` → ${record.foundEmail} (${record.patternUsed})` : '')
            + ` after ${result.checks} check${result.checks === 1 ? '' : 's'}`,
        );

        await Actor.pushData(record);
    }
}
