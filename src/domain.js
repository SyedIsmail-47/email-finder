/**
 * @param {unknown} value
 */
export function normalizeDomain(value) {
    let raw = String(value ?? '').trim().toLowerCase();
    if (!raw) throw new Error('Domain is required.');
    raw = raw.replace(/^https?:\/\//, '').replace(/^www\./, '');
    raw = raw.split('/')[0].split('?')[0].split('#')[0].replace(/\.$/, '');
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(raw) || raw.includes('..') || raw.startsWith('.') || raw.endsWith('.')) {
        throw new Error(`Domain "${value}" is not a hostname.`);
    }
    return raw;
}
