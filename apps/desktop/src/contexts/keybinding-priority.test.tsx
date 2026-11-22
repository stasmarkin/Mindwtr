import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import { useTaskStore } from '@mindwtr/core';
import { KeybindingProvider, useKeybindings, type ProjectListScope } from './keybinding-context';
import { LanguageProvider } from './language-context';
import { useUiStore } from '../store/ui-store';

const initialUiState = useUiStore.getState();
const initialTaskState = useTaskStore.getState();

function List({ stepPrioritySelected, projectOwnsFocus = false }: { stepPrioritySelected: (step: 1 | -1) => void; projectOwnsFocus?: boolean }) {
    const { registerTaskListScope, registerProjectListScope } = useKeybindings();
    useEffect(() => {
        registerTaskListScope({
            kind: 'taskList',
            selectNext: vi.fn(),
            selectPrev: vi.fn(),
            selectFirst: vi.fn(),
            selectLast: vi.fn(),
            editSelected: vi.fn(),
            toggleDoneSelected: vi.fn(),
            deleteSelected: vi.fn(),
            stepPrioritySelected,
        });
        const projectScope: ProjectListScope = {
            kind: 'projectList',
            selectNext: vi.fn(),
            selectPrev: vi.fn(),
            selectFirst: vi.fn(),
            selectLast: vi.fn(),
            focusSelected: () => false,
            ownsFocus: () => projectOwnsFocus,
        };
        registerProjectListScope(projectScope);
        return () => {
            registerTaskListScope(null);
            registerProjectListScope(null);
        };
    }, [projectOwnsFocus, registerProjectListScope, registerTaskListScope, stepPrioritySelected]);
    return <>
        <input aria-label="Title" />
        <textarea aria-label="Notes" />
    </>;
}

function renderList(props: { stepPrioritySelected: (step: 1 | -1) => void; projectOwnsFocus?: boolean }) {
    return render(<LanguageProvider><KeybindingProvider currentView="inbox" onNavigate={vi.fn()}>
        <List {...props} />
    </KeybindingProvider></LanguageProvider>);
}

describe('priority bracket shortcuts', () => {
    beforeEach(() => {
        useUiStore.setState({ editingTaskId: null });
    });
    afterEach(() => {
        act(() => {
            useUiStore.setState(initialUiState, true);
            useTaskStore.setState(initialTaskState, true);
        });
    });

    it.each(['vim', 'standard', 'emacs'] as const)('steps the selected task priority with [ and ] in %s style', (style) => {
        useTaskStore.setState((state) => ({ settings: { ...state.settings, keybindingStyle: style } }));
        const stepPrioritySelected = vi.fn();
        renderList({ stepPrioritySelected });

        fireEvent.keyDown(window, { key: ']' });
        fireEvent.keyDown(window, { key: '[' });

        expect(stepPrioritySelected.mock.calls).toEqual([[1], [-1]]);
    });

    it.each(['Title', 'Notes'])('leaves brackets typed into the %s field alone', (label) => {
        const stepPrioritySelected = vi.fn();
        renderList({ stepPrioritySelected });
        const field = screen.getByLabelText(label);
        field.focus();

        const event = new KeyboardEvent('keydown', { key: ']', bubbles: true, cancelable: true });
        act(() => { field.dispatchEvent(event); });

        expect(event.defaultPrevented).toBe(false);
        expect(stepPrioritySelected).not.toHaveBeenCalled();
    });

    it('ignores brackets with modifiers and while a task is being edited', () => {
        const stepPrioritySelected = vi.fn();
        renderList({ stepPrioritySelected });

        fireEvent.keyDown(window, { key: ']', ctrlKey: true });
        fireEvent.keyDown(window, { key: '[', metaKey: true });
        fireEvent.keyDown(window, { key: ']', altKey: true });
        act(() => { useUiStore.setState({ editingTaskId: 'task-1' }); });
        fireEvent.keyDown(window, { key: ']' });

        expect(stepPrioritySelected).not.toHaveBeenCalled();
    });

    it('steps priority once per press when the key auto-repeats', () => {
        const stepPrioritySelected = vi.fn();
        renderList({ stepPrioritySelected });

        fireEvent.keyDown(window, { key: ']' });
        fireEvent.keyDown(window, { key: ']', repeat: true });
        fireEvent.keyDown(window, { key: ']', repeat: true });

        expect(stepPrioritySelected).toHaveBeenCalledTimes(1);
    });

    it('does not step priority while the project list owns focus', () => {
        const stepPrioritySelected = vi.fn();
        renderList({ stepPrioritySelected, projectOwnsFocus: true });

        fireEvent.keyDown(window, { key: ']' });

        expect(stepPrioritySelected).not.toHaveBeenCalled();
    });

    it('lets a pending status chord swallow the bracket instead of stepping priority', () => {
        const stepPrioritySelected = vi.fn();
        renderList({ stepPrioritySelected });

        fireEvent.keyDown(window, { key: 's' });
        fireEvent.keyDown(window, { key: ']' });
        fireEvent.keyDown(window, { key: ']' });

        expect(stepPrioritySelected).toHaveBeenCalledTimes(1);
    });
});
