import assert from 'node:assert/strict';
import test from 'node:test';

import { createEmailFinder, EMAIL_STATUS, findEmailForPerson } from '../src/find.js';
import { createDomainGate } from '../vendor/email-verify/domainGate.js';

const person = { firstName: 'John', lastName: 'Doe', domain: 'example.com' };

test('stops at the first valid candidate and does not check the rest', async () => {
    const calls = [];
    const result = await findEmailForPerson(person, {
        gate: createDomainGate(2),
        async verifyEmail(email) {
            calls.push(email);
            if (email === 'jdoe@example.com') {
                return { email, status: 'valid', reason: 'Mailbox accepted' };
            }
            return { email, status: 'invalid', reason: 'Mailbox rejected by the mail server' };
        },
        async lookupMx() {
            return { found: true, hosts: ['mx.example.com'], nullMx: false, unreachable: false, timedOut: false };
        },
        disposableDomains: new Set(),
    });

    assert.deepEqual(calls, ['john.doe@example.com', 'jdoe@example.com']);
    assert.equal(result.emailStatus, EMAIL_STATUS.valid);
    assert.equal(result.foundEmail, 'jdoe@example.com');
    assert.equal(result.patternUsed, 'flast');
    assert.equal(result.checks, 2);
});

test('falls back to the first risky when nothing is valid', async () => {
    const result = await findEmailForPerson(person, {
        gate: createDomainGate(2),
        async verifyEmail(email) {
            if (email === 'john.doe@example.com') {
                return { email, status: 'risky', reason: 'catch-all domain' };
            }
            if (email === 'john@example.com') {
                return { email, status: 'risky', reason: 'catch-all domain' };
            }
            return { email, status: 'invalid', reason: 'Mailbox rejected by the mail server' };
        },
        async lookupMx() {
            return { found: true, hosts: ['mx.example.com'], nullMx: false, unreachable: false, timedOut: false };
        },
        disposableDomains: new Set(),
    });

    assert.equal(result.emailStatus, EMAIL_STATUS.risky);
    assert.equal(result.foundEmail, 'john.doe@example.com');
    assert.equal(result.patternUsed, 'first.last');
    assert.equal(result.checks, 5);
});

test('returns not_found or unknown when nothing is valid or risky', async () => {
    const notFound = await findEmailForPerson(person, {
        gate: createDomainGate(2),
        async verifyEmail(email) {
            return { email, status: 'invalid', reason: 'Mailbox rejected by the mail server' };
        },
        async lookupMx() {
            return { found: true, hosts: ['mx.example.com'], nullMx: false, unreachable: false, timedOut: false };
        },
        disposableDomains: new Set(),
    });
    assert.equal(notFound.emailStatus, EMAIL_STATUS.not_found);
    assert.equal(notFound.foundEmail, null);
    assert.equal(notFound.patternUsed, '');

    const unknown = await findEmailForPerson(person, {
        gate: createDomainGate(2),
        async verifyEmail(email) {
            return { email, status: 'unknown', reason: 'SMTP connection timed out' };
        },
        async lookupMx() {
            return { found: true, hosts: ['mx.example.com'], nullMx: false, unreachable: false, timedOut: false };
        },
        disposableDomains: new Set(),
    });
    assert.equal(unknown.emailStatus, EMAIL_STATUS.unknown);
    assert.equal(unknown.foundEmail, null);
});

test('shared domain gate keeps per-domain concurrency when two people share a domain', async () => {
    let active = 0;
    let peak = 0;
    const finder = createEmailFinder({
        maxConcurrentPerDomain: 2,
        async verifyEmail() {
            active += 1;
            peak = Math.max(peak, active);
            await new Promise((resolve) => setTimeout(resolve, 40));
            active -= 1;
            return { email: 'x@example.com', status: 'invalid', reason: 'Mailbox rejected by the mail server' };
        },
        async lookupMx() {
            return { found: true, hosts: ['mx.example.com'], nullMx: false, unreachable: false, timedOut: false };
        },
        disposableDomains: new Set(),
    });

    await Promise.all([
        finder.findEmail({ firstName: 'Ann', lastName: 'Lee', domain: 'shared.com' }),
        finder.findEmail({ firstName: 'Bob', lastName: 'Lee', domain: 'shared.com' }),
    ]);
    assert.ok(peak <= 2, `peak concurrency was ${peak}`);
});
