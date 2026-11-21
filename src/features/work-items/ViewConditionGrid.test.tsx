import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONDITION_GRID_FOCUS_ID, ViewConditionGrid } from './ViewConditionGrid';

const BASE = "SELECT [System.Id]\nFROM WorkItems\nWHERE [System.State] = 'Active'\nORDER BY [System.Id]";

function Harness({ initial = BASE, onChange = vi.fn() }: { initial?: string; onChange?: (v: string) => void }) {
  const [wiql, setWiql] = useState(initial);
  return (
    <>
      <ViewConditionGrid
        wiql={wiql}
        onWiqlChange={(value) => {
          setWiql(value);
          onChange(value);
        }}
        fields={[{ name: "Priority", referenceName: "Microsoft.VSTS.Common.Priority", fieldType: "integer", custom: false }]}
        hasProject
      />
      <pre data-testid="wiql">{wiql}</pre>
    </>
  );
}

describe('ViewConditionGrid', () => {
  afterEach(cleanup);

  it('shows WHERE conditions as rows and writes edits back to WIQL', () => {
    render(<Harness />);
    expect((screen.getByLabelText('Field for condition 1') as HTMLInputElement).value).toBe('System.State');
    fireEvent.change(screen.getByLabelText('Value for condition 1'), { target: { value: 'New' } });
    expect(screen.getByTestId('wiql').textContent).toBe(
      "SELECT [System.Id]\nFROM WorkItems\nWHERE [System.State] = 'New'\nORDER BY [System.Id]",
    );
  });

  it('adds a condition, focuses its field, and removes it again', () => {
    vi.useFakeTimers();
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Add condition' }));
    act(() => vi.runAllTimers());
    expect(document.activeElement).toBe(screen.getByLabelText('Field for condition 2'));
    fireEvent.change(screen.getByLabelText('Field for condition 2'), {
      target: { value: 'Microsoft.VSTS.Common.Priority' },
    });
    fireEvent.change(screen.getByLabelText('Operator for condition 2'), { target: { value: '<=' } });
    fireEvent.change(screen.getByLabelText('Value for condition 2'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('And/Or for condition 2'), { target: { value: 'OR' } });
    expect(screen.getByTestId('wiql').textContent).toContain(
      "WHERE [System.State] = 'Active'\n  OR [Microsoft.VSTS.Common.Priority] <= 2\nORDER BY",
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove condition 2' }));
    act(() => vi.runAllTimers());
    expect(document.activeElement?.id).toBe(CONDITION_GRID_FOCUS_ID);
    expect(screen.getByTestId('wiql').textContent).toBe(BASE);
    vi.useRealTimers();
  });

  it('keeps a half-typed list value while the box has focus', () => {
    render(<Harness initial="SELECT [System.Id] FROM WorkItems WHERE [System.WorkItemType] IN ('Bug')" />);
    const value = screen.getByLabelText('Value for condition 1') as HTMLInputElement;
    fireEvent.change(value, { target: { value: 'Bug, ' } });
    expect(value.value).toBe('Bug, ');
    fireEvent.blur(value);
    expect(value.value).toBe('Bug');
  });

  it('explains when the WIQL cannot be shown as conditions', () => {
    render(<Harness initial="SELECT [System.Id] FROM WorkItems WHERE ([System.State] = 'A' OR [System.State] = 'B')" />);
    expect(screen.getByRole('note').textContent).toMatch(/parentheses/);
    expect(screen.queryByRole('button', { name: 'Add condition' })).toBeNull();
  });
});
