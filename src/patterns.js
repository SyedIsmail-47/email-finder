/**
 * Local-part patterns tried in order. Stop at the first valid mailbox.
 * Duplicate addresses from different pattern names are checked once.
 */
export const PATTERN_ORDER = /** @type {const} */ ([
    'first.last',
    'flast',
    'first',
    'firstinitiallast',
    'last.first',
    'lastf',
]);

/**
 * Strip to lowercase ASCII letters/digits for local-part building.
 * @param {unknown} value
 */
export function normalizeNamePart(value) {
    const raw = String(value ?? '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '');
    return raw;
}

/**
 * @param {{ firstName: string, lastName: string, domain: string }} person
 * @returns {{ email: string, pattern: string }[]}
 */
export function generateCandidates(person) {
    const first = normalizeNamePart(person.firstName);
    const last = normalizeNamePart(person.lastName);
    const domain = String(person.domain).trim().toLowerCase();
    if (!first || !last) {
        throw new Error('firstName and lastName must each contain at least one letter or digit.');
    }
    if (!domain) throw new Error('domain is required.');

    const firstInitial = first[0];
    /** @type {Record<string, string>} */
    const locals = {
        'first.last': `${first}.${last}`,
        flast: `${firstInitial}${last}`,
        first,
        // Same mailbox as flast for ASCII names; kept as its own pattern name.
        firstinitiallast: `${firstInitial}${last}`,
        'last.first': `${last}.${first}`,
        lastf: `${last}${firstInitial}`,
    };

    /** @type {{ email: string, pattern: string }[]} */
    const candidates = [];
    const seen = new Set();
    for (const pattern of PATTERN_ORDER) {
        const local = locals[pattern];
        if (!local) continue;
        const email = `${local}@${domain}`;
        if (seen.has(email)) continue;
        seen.add(email);
        candidates.push({ email, pattern });
    }
    return candidates;
}
