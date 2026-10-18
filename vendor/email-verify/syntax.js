const LOCAL_PART = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i;
const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

/**
 * Accept ordinary addresses, including plus tags. Quoted local parts and
 * IP-literal domains are rejected.
 * @param {unknown} raw
 * @returns {{ ok: true, email: string, local: string, domain: string } | { ok: false, email: string }}
 */
export function parseEmail(raw) {
    const email = typeof raw === 'string' ? raw.trim() : '';
    if (!email || email.length > 254) return { ok: false, email };

    const at = email.indexOf('@');
    if (at <= 0 || at !== email.lastIndexOf('@')) return { ok: false, email };

    const local = email.slice(0, at);
    const domain = email.slice(at + 1);
    if (local.length > 64 || domain.length > 253) return { ok: false, email };
    if (!LOCAL_PART.test(local)) return { ok: false, email };
    if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) {
        return { ok: false, email };
    }

    if (domain.includes('..') || domain.startsWith('.') || domain.endsWith('.')) {
        return { ok: false, email };
    }

    const labels = domain.split('.');
    if (labels.length < 2) return { ok: false, email };
    const tld = labels[labels.length - 1];
    if (tld.length < 2) return { ok: false, email };
    if (labels.some((label) => label.length > 63 || !DOMAIN_LABEL.test(label))) {
        return { ok: false, email };
    }

    return {
        ok: true,
        email,
        local: local.toLowerCase(),
        domain: domain.toLowerCase(),
    };
}
