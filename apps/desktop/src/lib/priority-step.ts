import type { TaskPriority } from '@mindwtr/core';

export type PriorityStep = 1 | -1;

const PRIORITY_ORDER: ReadonlyArray<TaskPriority | undefined> = [undefined, 'low', 'medium', 'high', 'urgent'];

export function stepTaskPriority(current: TaskPriority | undefined, step: PriorityStep): TaskPriority | undefined {
    const currentIndex = Math.max(PRIORITY_ORDER.indexOf(current), 0);
    const nextIndex = Math.min(Math.max(currentIndex + step, 0), PRIORITY_ORDER.length - 1);
    return PRIORITY_ORDER[nextIndex];
}
