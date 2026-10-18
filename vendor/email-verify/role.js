/**
 * Local parts that name a function rather than a person.
 * Compared after lowercasing and stripping a +tag.
 */
const ROLE_LOCAL_PARTS = new Set([
    'abuse',
    'admin',
    'administrator',
    'billing',
    'careers',
    'compliance',
    'contact',
    'customercare',
    'customer-care',
    'customer.care',
    'customerservice',
    'customer-service',
    'customer.service',
    'enquiries',
    'enquiry',
    'finance',
    'help',
    'hello',
    'hostmaster',
    'hr',
    'info',
    'information',
    'inquiries',
    'inquiry',
    'jobs',
    'legal',
    'mail',
    'marketing',
    'media',
    'newsletter',
    'no-reply',
    'no.reply',
    'noc',
    'noreply',
    'office',
    'postmaster',
    'press',
    'privacy',
    'reception',
    'recruiting',
    'sales',
    'security',
    'support',
    'team',
    'unsubscribe',
    'webmaster',
]);

/**
 * @param {string} localPart already lowercased
 */
export function isRoleLocalPart(localPart) {
    const base = localPart.split('+')[0];
    return ROLE_LOCAL_PARTS.has(base);
}
