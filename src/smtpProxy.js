import { Actor, log } from 'apify';

import { createMxLookup } from '../vendor/email-verify/mx.js';
import { probeTcpReachable } from '../vendor/email-verify/smtp.js';

/** Apify residential group — useful for HTTP(S), not for SMTP port 25. */
export const SMTP_PROXY_GROUPS = /** @type {const} */ (['RESIDENTIAL']);

/**
 * Build an Apify residential proxy URL getter for diagnostics / optional use.
 * Apify Proxy does not successfully CONNECT to port 25 (measured), so this is
 * not used as the default SMTP path.
 * @returns {Promise<{
 *   getProxyUrl: () => Promise<string>,
 *   groups: string[],
 * } | null>}
 */
export async function createResidentialProxy() {
    const onPlatform = Actor.isAtHome?.() === true
        || process.env.APIFY_IS_AT_HOME === '1'
        || process.env.APIFY_IS_AT_HOME === 'true';
    const password = process.env.APIFY_PROXY_PASSWORD;
    if (!password && !onPlatform) return null;

    const proxyConfiguration = await Actor.createProxyConfiguration({
        groups: [...SMTP_PROXY_GROUPS],
    });
    if (!proxyConfiguration) return null;

    return {
        groups: [...SMTP_PROXY_GROUPS],
        async getProxyUrl() {
            const url = await proxyConfiguration.newUrl();
            if (!url) throw new Error('Apify proxy returned an empty URL.');
            return url;
        },
    };
}

/**
 * Optional operator-supplied proxy that permits CONNECT to port 25 (or SOCKS
 * later). When set, every SMTP dial tunnels through it.
 * @param {string | null | undefined} proxyUrl
 * @returns {{ getProxyUrl: () => Promise<string> } | null}
 */
export function createStaticSmtpProxy(proxyUrl) {
    const url = typeof proxyUrl === 'string' ? proxyUrl.trim() : '';
    if (!url) return null;
    return {
        async getProxyUrl() {
            return url;
        },
    };
}

/**
 * Prove what the platform allows: direct :25, residential CONNECT :25, and
 * residential CONNECT :443 as a control that the proxy itself works.
 * @param {string[]} domains
 * @param {{ getProxyUrl: () => Promise<string> } | null} residential
 * @param {{ smtpTimeoutMs?: number, log?: { info: Function } }} [options]
 */
export async function confirmSmtpProxyPath(domains, residential, options = {}) {
    const timeoutMs = Math.min(options.smtpTimeoutMs ?? 10_000, 10_000);
    const logger = options.log ?? log;
    const lookupMx = createMxLookup({ timeoutMs });
    /** @type {object[]} */
    const rows = [];

    for (const domain of domains) {
        const mx = await lookupMx(domain);
        const host = mx.found && mx.hosts?.[0] ? mx.hosts[0] : null;
        if (!host) {
            logger.info(`Port path check ${domain}: no MX host to probe`);
            continue;
        }

        const direct25 = await probeTcpReachable(host, 25, Math.min(3_000, timeoutMs), null);
        let residential25 = null;
        if (residential) {
            residential25 = await probeTcpReachable(host, 25, timeoutMs, await residential.getProxyUrl());
        }

        rows.push({ domain, host, direct25, residential25 });
        logger.info(
            `Port path check ${domain} via ${host}: `
            + `direct:25=${formatProbe(direct25)} `
            + `residential:25=${formatProbe(residential25)}`,
        );
    }

    // Control: residential CONNECT to a normal HTTPS host (not an MX hostname).
    let httpsControl = null;
    if (residential) {
        httpsControl = await probeTcpReachable('www.google.com', 443, timeoutMs, await residential.getProxyUrl());
        logger.info(`Port path control residential www.google.com:443=${formatProbe(httpsControl)}`);
    }

    const directOk = rows.filter((row) => row.direct25?.ok).length;
    const res25Ok = rows.filter((row) => row.residential25?.ok).length;
    const httpsOk = Boolean(httpsControl?.ok);
    logger.info(
        `Port path summary: direct:25 ${directOk}/${rows.length}, `
        + `residential:25 ${res25Ok}/${rows.length}, `
        + `residential https control ${httpsOk ? 'OK' : 'FAIL'}`,
    );
    if (rows.length && httpsOk && res25Ok === 0) {
        logger.warning(
            'Apify residential proxy can CONNECT to https :443 but not to SMTP :25. '
            + 'Mailbox checks need an external proxy/relay that allows CONNECT host:25.',
        );
    } else if (rows.length && directOk === 0 && res25Ok === 0) {
        logger.warning(
            'Outbound SMTP port 25 is unreachable on this host (direct and residential).',
        );
    }
    return { rows, directOk, res25Ok, httpsOk, httpsControl };
}

/**
 * @param {{ ok?: boolean, ms?: number, error?: string, proxyStatus?: number, message?: string } | null} probe
 */
function formatProbe(probe) {
    if (!probe) return 'n/a';
    if (probe.ok) return `OK(${probe.ms}ms)`;
    const detail = probe.proxyStatus
        ? `HTTP ${probe.proxyStatus}`
        : (probe.error || probe.message || 'FAIL');
    return `FAIL(${probe.ms}ms ${detail})`;
}
