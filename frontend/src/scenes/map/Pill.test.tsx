// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { renderWithApp, screen } from '../../test/dom';
import { Pill } from './Pill';

describe('the pill once the actors are made', () => {
  it('offers the constraints beside Simulate, so that the limits on the decision are read before it runs', async () => {
    const onContinue = vi.fn();
    const onConstraints = vi.fn();
    const { user } = renderWithApp(
      <Pill model={{ kind: 'ready', actors: 3, onContinue, onConstraints }} />,
    );
    expect(screen.getByText('actors ready')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Constraints' }));
    expect(onConstraints).toHaveBeenCalledOnce();
    expect(onContinue).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Simulate' }));
    expect(onContinue).toHaveBeenCalledOnce();
  });

  it('offers only Simulate where the person cannot read constraints', () => {
    renderWithApp(<Pill model={{ kind: 'ready', actors: 1, onContinue: vi.fn() }} />);
    expect(screen.getByRole('button', { name: 'Simulate' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Constraints' })).toBeNull();
  });
});
