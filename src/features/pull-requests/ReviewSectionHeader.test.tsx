import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ReviewSectionHeader } from './ReviewSectionHeader';

describe('ReviewSectionHeader', () => {
  it('shows only the label and count, collapsed or not', () => {
    const { rerender } = render(<ReviewSectionHeader label="Approved" count={2} collapsed onToggle={() => {}} />);
    const button = screen.getByRole('button', { name: /^Approved\s*· 2$/ });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    rerender(<ReviewSectionHeader label="Approved" count={2} collapsed={false} onToggle={() => {}} />);
    expect(screen.getByRole('button', { name: /^Approved\s*· 2$/ }).getAttribute('aria-expanded')).toBe('true');
  });
});
