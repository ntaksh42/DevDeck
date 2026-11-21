import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ViewAdvancedSettings } from './ViewAdvancedSettings';
import type { ViewEditorDraftReturn } from './useViewEditorDraft';

function renderSettings(overrides: Partial<ViewEditorDraftReturn> = {}) {
  const draft = {
    draftLimit: '200',
    onLimitChange: vi.fn(),
    draftRefreshInterval: '',
    onRefreshIntervalChange: vi.fn(),
    draftAlertThreshold: '',
    onAlertThresholdChange: vi.fn(),
    draftExtraColumns: ['System.Tags'],
    onExtraColumnsChange: vi.fn(),
    fields: [],
    fieldsLoading: false,
    formError: null,
    ...overrides,
  } as unknown as ViewEditorDraftReturn;
  render(<ViewAdvancedSettings draft={draft} />);
  return screen.getByText('Advanced settings').closest('details') as HTMLDetailsElement;
}

describe('ViewAdvancedSettings', () => {
  afterEach(cleanup);

  it('starts collapsed and summarizes the current values', () => {
    const details = renderSettings({ draftRefreshInterval: '60', draftAlertThreshold: '5' });
    expect(details.open).toBe(false);
    expect(details.querySelector('summary')?.textContent).toContain(
      'Limit 200 · Refresh 60s · Alert ≥ 5 · Columns 1',
    );
  });

  it('opens itself when the form error is about a hidden field', () => {
    const details = renderSettings({ formError: 'Auto refresh must be a number of seconds.' });
    expect(details.open).toBe(true);
  });

  it('stays collapsed for errors about visible fields', () => {
    const details = renderSettings({ formError: 'View name is required.' });
    expect(details.open).toBe(false);
  });
});
