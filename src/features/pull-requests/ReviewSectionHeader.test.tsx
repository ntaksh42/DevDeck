import { render, screen } from '@testing-library/react';
import { useColumnDrag } from '@/lib/columnDrag';
import { describe, expect, it } from 'vitest';
import { ReviewSectionHeader } from './ReviewSectionHeader';
import { sectionPreview } from './myReviewsHelpers';
import type { ReviewPullRequestSummary } from '@/lib/azdoCommands';

const pr = (id: number, title: string) => ({ pullRequestId: id, title }) as ReviewPullRequestSummary;

describe('sectionPreview', () => {
  it('joins the first three PRs as "#id title"', () => {
    expect(sectionPreview([pr(87, 'Fix flaky'), pr(90, 'Bump axios'), pr(91, 'C'), pr(92, 'D')])).toBe(
      '#87 Fix flaky · #90 Bump axios · #91 C',
    );
  });
});

function Header({ collapsed }: { collapsed: boolean }) {
  const drag = useColumnDrag(() => {});
  return (
    <ReviewSectionHeader
      label="Approved by you" count={2} collapsed={collapsed} preview="#87 Fix · #90 Bump"
      onToggle={() => {}} groupKey="approved" drag={drag('approved')} onMove={() => {}}
    />
  );
}

describe('ReviewSectionHeader', () => {
  it('shows the preview only when collapsed, hidden from the accessible name', () => {
    const { rerender } = render(
      <Header collapsed />,
    );
    expect(screen.getByText('#87 Fix · #90 Bump').getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByRole('button', { name: /^Approved by you\s*\(2\)$/ })).toBeTruthy();
    rerender(
      <Header collapsed={false} />,
    );
    expect(screen.queryByText('#87 Fix · #90 Bump')).toBeNull();
  });
});
