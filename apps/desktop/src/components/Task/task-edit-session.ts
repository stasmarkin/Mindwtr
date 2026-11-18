


const activeSessions = new Map<string, object>();
let activeExitRequest: ((action: () => void) => void) | null = null;
let activeFlush: (() => Promise<TaskEditFlushOutcome>) | null = null;

export type TaskEditFlushOutcome = 'saved' | 'clean' | 'blocked' | 'failed';
export type TaskEditCloseOutcome = TaskEditFlushOutcome | 'none';

export function registerTaskEditExitRequest(request: (action: () => void) => void): () => void {
    activeExitRequest = request;
    return () => {
        if (activeExitRequest === request) activeExitRequest = null;
    };
}

export function runAfterTaskEditExit(action: () => void): void {
    if (activeExitRequest) activeExitRequest(action);
    else action();
}

export function registerTaskEditFlush(flush: () => Promise<TaskEditFlushOutcome>): () => void {
    activeFlush = flush;
    return () => {
        if (activeFlush === flush) activeFlush = null;
    };
}

export const TASK_EDIT_CLOSE_FLUSH_TIMEOUT_MS = 3000;

export async function flushForClose(flushStore: () => Promise<void>, onError?: (error: unknown) => void): Promise<TaskEditCloseOutcome> {
    const flush = activeFlush;
    if (!flush) {
        await flushStore();
        return 'none';
    }
    let storeFailed = false;
    const flushStoreReportingErrors = () => flushStore().catch((error: unknown) => {
        storeFailed = true;
        onError?.(error);
    });
    const storeFlush = flushStoreReportingErrors();
    const editorFlush = Promise.resolve().then(flush).catch((error: unknown): TaskEditFlushOutcome => {
        onError?.(error);
        return 'failed';
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = await Promise.race([
        editorFlush.then(() => false),
        new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(true), TASK_EDIT_CLOSE_FLUSH_TIMEOUT_MS); }),
    ]);
    clearTimeout(timer);
    if (timedOut) await flushStoreReportingErrors();
    const outcome = await editorFlush;
    await storeFlush;
    await flushStoreReportingErrors();
    return storeFailed && !isTaskEditLeftUnsaved(outcome) ? 'failed' : outcome;
}

export function isTaskEditLeftUnsaved(outcome: TaskEditCloseOutcome | undefined): boolean {
    return outcome === 'blocked' || outcome === 'failed';
}

export function tryClaimTaskEditSession(taskId: string, owner: object): boolean {
    const current = activeSessions.get(taskId);
    if (current && current !== owner) return false;
    activeSessions.set(taskId, owner);
    return true;
}

export function releaseTaskEditSession(taskId: string, owner: object): boolean {
    if (activeSessions.get(taskId) !== owner) return false;
    activeSessions.delete(taskId);
    return true;
}
