import { describe, expect, it, vi } from 'vitest';

import { flushForClose, registerTaskEditFlush, type TaskEditCloseOutcome } from '../components/Task/task-edit-session';
import { raceCloseFlush } from './close-flush-race';
import { quitAfterCloseFlush } from './quit-after-close-flush';

const setup = (value: TaskEditCloseOutcome | undefined, confirmed = false, timedOut = false) => ({
    flushBeforeQuit: vi.fn(async () => (value === undefined ? { timedOut } : { timedOut, value })),
    confirmQuitWithUnsavedEdits: vi.fn(async () => confirmed),
    keepOpen: vi.fn(),
    quit: vi.fn(async () => {}),
});

describe('quitAfterCloseFlush', () => {
    it.each<TaskEditCloseOutcome>(['saved', 'clean', 'none'])('quits without asking when the editor flush is %s', async (value) => {
        const options = setup(value);
        await quitAfterCloseFlush(options);
        expect(options.confirmQuitWithUnsavedEdits).not.toHaveBeenCalled();
        expect(options.quit).toHaveBeenCalledOnce();
    });

    it.each<TaskEditCloseOutcome>(['blocked', 'failed'])('keeps the app open when the editor flush is %s and the user cancels', async (value) => {
        const options = setup(value, false);
        await quitAfterCloseFlush(options);
        expect(options.confirmQuitWithUnsavedEdits).toHaveBeenCalledOnce();
        expect(options.keepOpen).toHaveBeenCalledOnce();
        expect(options.quit).not.toHaveBeenCalled();
    });

    it('quits when the editor flush failed and the user confirms losing the edits', async () => {
        const options = setup('failed', true);
        await quitAfterCloseFlush(options);
        expect(options.keepOpen).not.toHaveBeenCalled();
        expect(options.quit).toHaveBeenCalledOnce();
    });

    it('does not ask again when the caller already accepted losing unsaved edits', async () => {
        const options = setup('blocked');
        await quitAfterCloseFlush({ ...options, acceptUnsavedEdits: true });
        expect(options.confirmQuitWithUnsavedEdits).not.toHaveBeenCalled();
        expect(options.quit).toHaveBeenCalledOnce();
    });

    it('quits after a timed-out flush without an editor outcome', async () => {
        const options = setup(undefined, false, true);
        await quitAfterCloseFlush(options);
        expect(options.confirmQuitWithUnsavedEdits).not.toHaveBeenCalled();
        expect(options.quit).toHaveBeenCalledOnce();
    });

    it.each<'blocked' | 'failed'>(['blocked', 'failed'])('asks before quitting when the editor flush is %s and the final store write rejects', async (outcome) => {
        const release = registerTaskEditFlush(async () => outcome);
        const flushStore = vi.fn(async () => {});
        flushStore.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('write failed'));
        const options = setup(undefined);
        try {
            await quitAfterCloseFlush({
                ...options,
                flushBeforeQuit: () => raceCloseFlush({
                    flush: () => flushForClose(flushStore, vi.fn()),
                    timeoutMs: 10_000,
                    reportError: vi.fn(),
                }),
            });
        } finally {
            release();
        }
        expect(options.confirmQuitWithUnsavedEdits).toHaveBeenCalledOnce();
        expect(options.keepOpen).toHaveBeenCalledOnce();
        expect(options.quit).not.toHaveBeenCalled();
    });
});
