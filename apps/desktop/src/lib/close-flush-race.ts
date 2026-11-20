export type CloseFlushRaceOptions<T = void> = {
    flush: () => Promise<T>;
    timeoutMs: number;
    logStep?: (step: string) => void;
    reportError: (label: string, error: unknown) => void;
};

export type CloseFlushRaceResult<T = void> = {
    timedOut: boolean;
    value?: T;
};

export async function raceCloseFlush<T = void>({
    flush,
    timeoutMs,
    logStep,
    reportError,
}: CloseFlushRaceOptions<T>): Promise<CloseFlushRaceResult<T>> {
    logStep?.('flush before close started');
    let value: T | undefined;
    const flushPromise = flush().then(
        (result) => { value = result; },
        (error) => reportError('Save failed', error),
    );

    let timeoutId: ReturnType<typeof setTimeout>;
    const timedOut = await Promise.race([
        flushPromise.then(() => false),
        new Promise<boolean>((resolve) => {
            timeoutId = setTimeout(() => resolve(true), timeoutMs);
        }),
    ]);
    clearTimeout(timeoutId!);

    logStep?.(timedOut ? `flush before close timed out after ${timeoutMs}ms` : 'flush before close settled');
    return timedOut || value === undefined ? { timedOut } : { timedOut, value };
}
