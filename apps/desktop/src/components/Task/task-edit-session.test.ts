import { describe, expect, it, vi } from 'vitest';

import { TASK_EDIT_CLOSE_FLUSH_TIMEOUT_MS, flushForClose, isTaskEditLeftUnsaved, registerTaskEditFlush, type TaskEditFlushOutcome } from './task-edit-session';

describe('flushForClose', () => {
    it('starts the store flush synchronously and flushes the store again after the editor flush', async () => {
        const calls: string[] = [];
        const release = registerTaskEditFlush(async () => { calls.push('editor'); return 'saved'; });
        try {
            const closing = flushForClose(async () => { calls.push('store'); });
            expect(calls).toEqual(['store']);
            await closing;
        } finally {
            release();
        }
        expect(calls).toEqual(['store', 'editor', 'store']);
    });

    it('still flushes the store when the editor flush rejects', async () => {
        const failure = new Error('editor flush failed');
        const release = registerTaskEditFlush(() => Promise.reject(failure));
        const flushStore = vi.fn(async () => {});
        const onError = vi.fn();
        try {
            await expect(flushForClose(flushStore, onError)).resolves.toBe('failed');
            await expect(flushForClose(flushStore)).resolves.toBe('failed');
        } finally {
            release();
        }
        expect(onError).toHaveBeenCalledWith(failure);
        expect(flushStore).toHaveBeenCalledTimes(4);
    });

    it('only flushes the store when no editor flush is registered', async () => {
        const editorFlush = vi.fn(async () => 'saved' as const);
        registerTaskEditFlush(editorFlush)();
        const flushStore = vi.fn(async () => {});
        await expect(flushForClose(flushStore)).resolves.toBe('none');
        expect(editorFlush).not.toHaveBeenCalled();
        expect(flushStore).toHaveBeenCalledOnce();
    });

    it('flushes the store at once, at the timeout and again once a slow editor flush lands', async () => {
        vi.useFakeTimers();
        const release = registerTaskEditFlush(() => new Promise<'saved'>((resolve) => { setTimeout(() => resolve('saved'), 4000); }));
        const flushStore = vi.fn(async () => {});
        let done = false;
        try {
            const closing = flushForClose(flushStore).then(() => { done = true; });
            expect(flushStore).toHaveBeenCalledOnce();
            await vi.advanceTimersByTimeAsync(TASK_EDIT_CLOSE_FLUSH_TIMEOUT_MS - 1);
            expect(flushStore).toHaveBeenCalledOnce();
            await vi.advanceTimersByTimeAsync(1);
            expect(flushStore).toHaveBeenCalledTimes(2);
            await vi.advanceTimersByTimeAsync(4000 - TASK_EDIT_CLOSE_FLUSH_TIMEOUT_MS - 1);
            expect(done).toBe(false);
            await vi.advanceTimersByTimeAsync(1);
            await closing;
            expect(flushStore).toHaveBeenCalledTimes(3);
        } finally {
            release();
            vi.useRealTimers();
        }
    });

    it('flushes the store at once and at the timeout, and stays pending while the editor flush hangs', async () => {
        vi.useFakeTimers();
        const release = registerTaskEditFlush(() => new Promise<never>(() => {}));
        const flushStore = vi.fn(async () => {});
        let done = false;
        try {
            void flushForClose(flushStore).then(() => { done = true; });
            expect(flushStore).toHaveBeenCalledOnce();
            await vi.advanceTimersByTimeAsync(TASK_EDIT_CLOSE_FLUSH_TIMEOUT_MS);
            expect(flushStore).toHaveBeenCalledTimes(2);
            await vi.advanceTimersByTimeAsync(60_000);
            expect(done).toBe(false);
            expect(flushStore).toHaveBeenCalledTimes(2);
        } finally {
            release();
            vi.useRealTimers();
        }
    });

    it.each<[TaskEditFlushOutcome, TaskEditFlushOutcome]>([
        ['saved', 'failed'],
        ['clean', 'failed'],
        ['blocked', 'blocked'],
        ['failed', 'failed'],
    ])('reports an editor flush outcome %s as %s when the final store flush rejects', async (editorOutcome, expected) => {
        const failure = new Error('store flush failed');
        const release = registerTaskEditFlush(async () => editorOutcome);
        const flushStore = vi.fn(async () => {});
        flushStore.mockResolvedValueOnce(undefined).mockRejectedValueOnce(failure);
        const onError = vi.fn();
        try {
            await expect(flushForClose(flushStore, onError)).resolves.toBe(expected);
        } finally {
            release();
        }
        expect(onError).toHaveBeenCalledWith(failure);
    });

    it('reports a saved editor as failed when the first store flush rejects even though the final one resolves', async () => {
        const release = registerTaskEditFlush(async () => 'saved');
        const flushStore = vi.fn(async () => {});
        flushStore.mockRejectedValueOnce(new Error('snapshot dropped after retries'));
        try {
            await expect(flushForClose(flushStore, vi.fn())).resolves.toBe('failed');
        } finally {
            release();
        }
        expect(flushStore).toHaveBeenCalledTimes(2);
    });

    it.each<TaskEditFlushOutcome>(['saved', 'clean', 'blocked', 'failed'])('reports the editor flush outcome %s after flushing the store', async (outcome) => {
        const release = registerTaskEditFlush(async () => outcome);
        const flushStore = vi.fn(async () => {});
        try {
            await expect(flushForClose(flushStore)).resolves.toBe(outcome);
        } finally {
            release();
        }
        expect(flushStore).toHaveBeenCalledTimes(2);
    });
});

describe('isTaskEditLeftUnsaved', () => {
    it('treats only blocked and failed editor flushes as unsaved', () => {
        expect(isTaskEditLeftUnsaved('blocked')).toBe(true);
        expect(isTaskEditLeftUnsaved('failed')).toBe(true);
        expect(isTaskEditLeftUnsaved('saved')).toBe(false);
        expect(isTaskEditLeftUnsaved('clean')).toBe(false);
        expect(isTaskEditLeftUnsaved('none')).toBe(false);
        expect(isTaskEditLeftUnsaved(undefined)).toBe(false);
    });
});
