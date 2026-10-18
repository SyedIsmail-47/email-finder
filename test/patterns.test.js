import assert from 'node:assert/strict';
import test from 'node:test';

import { generateCandidates, normalizeNamePart, PATTERN_ORDER } from '../src/patterns.js';

test('normalizeNamePart strips accents and punctuation', () => {
    assert.equal(normalizeNamePart('José'), 'jose');
    assert.equal(normalizeNamePart("O'Neil"), 'oneil');
    assert.equal(normalizeNamePart('  Ada  '), 'ada');
});

test('generateCandidates builds the six patterns and dedupes flast / firstinitiallast', () => {
    assert.deepEqual(PATTERN_ORDER, [
        'first.last',
        'flast',
        'first',
        'firstinitiallast',
        'last.first',
        'lastf',
    ]);
    assert.deepEqual(
        generateCandidates({ firstName: 'John', lastName: 'Doe', domain: 'Example.COM' }),
        [
            { email: 'john.doe@example.com', pattern: 'first.last' },
            { email: 'jdoe@example.com', pattern: 'flast' },
            { email: 'john@example.com', pattern: 'first' },
            { email: 'doe.john@example.com', pattern: 'last.first' },
            { email: 'doej@example.com', pattern: 'lastf' },
        ],
    );
});

test('generateCandidates rejects empty name parts after normalization', () => {
    assert.throws(
        () => generateCandidates({ firstName: '---', lastName: 'Doe', domain: 'x.com' }),
        /firstName and lastName/,
    );
});
