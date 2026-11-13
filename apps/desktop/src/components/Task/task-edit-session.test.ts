import { describe, expect, it, vi } from 'vitest';

import { TASK_EDIT_CLOSE_FLUSH_TIMEOUT_MS, flushForClose, registerTaskEditFlush } from './task-edit-session';

describe('flushForClose', () => {
    it('starts the store flush synchronously and flushes the store again after the editor flush', async () => {
        const calls: string[] = [];
        const release = registerTaskEditFlush(async () => { calls.push('editor'); });
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
            await flushForClose(flushStore, onError);
            await expect(flushForClose(flushStore)).resolves.toBeUndefined();
        } finally {
            release();
        }
        expect(onError).toHaveBeenCalledWith(failure);
        expect(flushStore).toHaveBeenCalledTimes(4);
    });

    it('only flushes the store when no editor flush is registered', async () => {
        const editorFlush = vi.fn(async () => {});
        registerTaskEditFlush(editorFlush)();
        const flushStore = vi.fn(async () => {});
        await flushForClose(flushStore);
        expect(editorFlush).not.toHaveBeenCalled();
        expect(flushStore).toHaveBeenCalledOnce();
    });

    it('flushes the store at once, at the timeout and again once a slow editor flush lands', async () => {
        vi.useFakeTimers();
        const release = registerTaskEditFlush(() => new Promise<void>((resolve) => { setTimeout(resolve, 4000); }));
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
});
