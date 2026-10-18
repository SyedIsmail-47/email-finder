import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Vendored from https://github.com/disposable-email-domains/disposable-email-domains */
const DEFAULT_LIST = join(dirname(fileURLToPath(import.meta.url)), 'data/disposable-domains.txt');

/**
 * @param {string} [filePath]
 * @returns {Set<string>}
 */
export function loadDisposableDomains(filePath = DEFAULT_LIST) {
    const text = readFileSync(filePath, 'utf8');
    const domains = new Set();
    for (const line of text.split(/\r?\n/)) {
        const domain = line.trim().toLowerCase();
        if (!domain || domain.startsWith('#') || domain.startsWith('//')) continue;
        domains.add(domain);
    }
    return domains;
}

/**
 * True when `domain` or one of its parents is on the list.
 * `mail.mailinator.com` matches `mailinator.com`. The bare TLD is not checked.
 * @param {string} domain
 * @param {Set<string>} domains
 */
export function isDisposableDomain(domain, domains) {
    let current = domain.toLowerCase();
    while (current.includes('.')) {
        if (domains.has(current)) return true;
        current = current.slice(current.indexOf('.') + 1);
    }
    return false;
}
