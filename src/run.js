import { Actor, log } from 'apify';

import { createEmailFinder } from './find.js';
import {
    confirmSmtpProxyPath,
    createResidentialProxy,
    createStaticSmtpProxy,
} from './smtpProxy.js';

/**
 * Generate name-based candidates for each person and verify them through the
 * vendored bulk-email-verifier engine. One shared per-domain gate for the run.
 *
 * Outbound port 25 is blocked on Apify hosts, and Apify residential proxy does
 * not successfully CONNECT to :25 either. Pass input.smtpProxyUrl only when you
 * have an external proxy/relay that allows CONNECT host:25.
 * @param {ReturnType<import('./input.js').normalizeInput>} input
 */
export async function runEmailFinder(input) {
    const residential = await createResidentialProxy();
    if (residential || Actor.isAtHome?.()) {
        const domains = [...new Set(input.people.map((person) => person.domain))];
        await confirmSmtpProxyPath(domains, residential, {
            smtpTimeoutMs: input.smtpTimeoutMs,
            log,
        });
    }

    const smtpProxy = createStaticSmtpProxy(input.smtpProxyUrl);
    if (smtpProxy) {
        log.info('SMTP connections tunnel through the operator-supplied smtpProxyUrl.');
    } else if (Actor.isAtHome?.()) {
        log.warning(
            'No smtpProxyUrl set. On Apify, mailbox SMTP will fail until an external '
            + 'port-25 CONNECT proxy/relay is configured.',
        );
    }

    const finder = createEmailFinder({
        maxConcurrentPerDomain: input.maxConcurrentPerDomain,
        smtpTimeoutMs: input.smtpTimeoutMs,
        checkCatchAll: true,
        checkRoleAccounts: true,
        getProxyUrl: smtpProxy?.getProxyUrl,
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
