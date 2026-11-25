export const TASK_ROW_ACTION_EVENT = 'mindwtr:task-row-action';

export type TaskRowAction = 'toggle-focus' | 'rename-title' | 'raise-priority' | 'lower-priority';

export function requestTaskRowAction(element: HTMLElement | null, action: TaskRowAction): boolean {
    if (!element) return false;
    element.dispatchEvent(new CustomEvent<TaskRowAction>(TASK_ROW_ACTION_EVENT, { detail: action }));
    return true;
}
