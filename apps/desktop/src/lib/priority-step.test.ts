import { describe, expect, it } from 'vitest';
import type { TaskPriority } from '@mindwtr/core';
import { stepTaskPriority } from './priority-step';

describe('stepTaskPriority', () => {
    it.each([
        [undefined, 'low'],
        ['low', 'medium'],
        ['medium', 'high'],
        ['high', 'urgent'],
        ['urgent', 'urgent'],
    ] as const)('raises %s to %s', (current, expected) => {
        expect(stepTaskPriority(current, 1)).toBe(expected);
    });

    it.each([
        ['urgent', 'high'],
        ['high', 'medium'],
        ['medium', 'low'],
        ['low', undefined],
        [undefined, undefined],
    ] as const)('lowers %s to %s', (current, expected) => {
        expect(stepTaskPriority(current, -1)).toBe(expected);
    });

    it('treats an unknown stored priority as none', () => {
        expect(stepTaskPriority('bogus' as TaskPriority, 1)).toBe('low');
        expect(stepTaskPriority('bogus' as TaskPriority, -1)).toBeUndefined();
    });
});
