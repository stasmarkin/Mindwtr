import type { TaskEditCloseOutcome } from '../components/Task/task-edit-session';
import { raceCloseFlush, type CloseFlushRaceOptions, type CloseFlushRaceResult } from './close-flush-race';


let closeSequenceFlushPromise: Promise<CloseFlushRaceResult<TaskEditCloseOutcome>> | null = null;

export function beginCloseFlush(options: CloseFlushRaceOptions<TaskEditCloseOutcome>): Promise<CloseFlushRaceResult<TaskEditCloseOutcome>> {
    if (!closeSequenceFlushPromise) closeSequenceFlushPromise = raceCloseFlush(options);
    return closeSequenceFlushPromise;
}


export function resetCloseFlushGate(): void {
    closeSequenceFlushPromise = null;
}
