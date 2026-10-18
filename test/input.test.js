import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { normalizeInput } from '../src/input.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('prefill is one synthetic .invalid person with safe defaults', () => {
    const schema = JSON.parse(fs.readFileSync(path.join(root, '.actor/input_schema.json'), 'utf8'));
    const people = schema.properties.people;
    assert.deepEqual(people.default, people.prefill);
    assert.equal(people.prefill.length, 1);
    assert.equal(people.prefill[0].domain.endsWith('.invalid'), true);
    assert.equal(schema.properties.maxConcurrentPerDomain.maximum, 3);
    assert.equal(schema.properties.maxConcurrentPerDomain.default, 2);
    assert.equal(schema.properties.smtpTimeoutMs.default, 10000);
});

test('normalizeInput fills defaults and normalizes domains', () => {
    const input = normalizeInput({
        people: [{ firstName: 'Ada', lastName: 'Lovelace', domain: 'https://www.Example.com/team' }],
    });
    assert.deepEqual(input.people, [
        { firstName: 'Ada', lastName: 'Lovelace', domain: 'example.com' },
    ]);
    assert.equal(input.smtpTimeoutMs, 10000);
    assert.equal(input.maxConcurrentPerDomain, 2);
});

test('normalizeInput rejects empty people and bad domains', () => {
    assert.throws(() => normalizeInput({ people: [] }), /at least one person/);
    assert.throws(
        () => normalizeInput({ people: [{ firstName: 'A', lastName: 'B', domain: 'not a domain' }] }),
        /hostname/,
    );
    assert.throws(
        () => normalizeInput({
            people: [{ firstName: 'A', lastName: 'B', domain: 'x.com' }],
            maxConcurrentPerDomain: 9,
        }),
        /maxConcurrentPerDomain/,
    );
});
