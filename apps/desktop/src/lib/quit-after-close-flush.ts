import { isTaskEditLeftUnsaved, type TaskEditCloseOutcome } from '../components/Task/task-edit-session';
import type { CloseFlushRaceResult } from './close-flush-race';

type QuitAfterCloseFlushOptions = {
    flushBeforeQuit: () => Promise<CloseFlushRaceResult<TaskEditCloseOutcome>>;
    confirmQuitWithUnsavedEdits: () => Promise<boolean>;
    keepOpen: () => void;
    quit: () => Promise<void>;
    acceptUnsavedEdits?: boolean;
};

export async function quitAfterCloseFlush({
    flushBeforeQuit,
    confirmQuitWithUnsavedEdits,
    keepOpen,
    quit,
    acceptUnsavedEdits = false,
}: QuitAfterCloseFlushOptions): Promise<void> {
    const { value } = await flushBeforeQuit();
    if (!acceptUnsavedEdits && isTaskEditLeftUnsaved(value) && !(await confirmQuitWithUnsavedEdits())) {
        keepOpen();
        return;
    }
    await quit();
}
