/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CSSProperties } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeatureColorPicker } from '../motif-artifact';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('FeatureColorPicker', () => {
  it('shows the active theme color without replacing the stored semantic token', async () => {
    const onChange = vi.fn();
    const storedColor = 'var(--accent, #7E9BBF)';
    render(
      <div data-theme="light" style={{ '--accent': '#0169cc' } as CSSProperties}>
        <FeatureColorPicker storedColor={storedColor} onChange={onChange} />
      </div>,
    );

    const picker = screen.getByLabelText('Feature color') as HTMLInputElement;
    await waitFor(() => expect(picker.value).toBe('#0169cc'));
    expect(onChange).not.toHaveBeenCalled();
    expect(storedColor).toBe('var(--accent, #7E9BBF)');
  });

  it('replaces the stored value only after the user chooses a picker color', () => {
    const onChange = vi.fn();
    render(<FeatureColorPicker storedColor="var(--accent, #7E9BBF)" onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Feature color'), { target: { value: '#abcdef' } });
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith('#abcdef');
  });
});
