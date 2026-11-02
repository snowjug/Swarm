// @vitest-environment jsdom
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { AppConfig, ProjectDetail } from '../../../../../shared/types';
import { WorkspaceContext } from '../../../app/context';
import { Sheet, SheetContent } from '../../../design/ui';
import { act, renderWithApp, screen, waitFor, workspaceStub } from '../../../test/dom';
import { deepFixture } from './fixture';
import DeepDive from './index';

// A proxy of the deep dive opens in a sheet, and "Ask" in that sheet opens the Ask panel in its own. The focus is the
// panel's from then on: the control that opened the proxy sheet is not given it back a frame later.

const project: ProjectDetail = deepFixture({ simulation: 'pending', saved: 0 });
const proxy = project.agents[0]!;

/** The page, and an Ask panel of its own that opens at once and takes the focus, as it does when its code is loaded. */
function Shell() {
  const [asking, setAsking] = useState(false);
  const workspace = workspaceStub({
    project,
    config: { capabilities: { whatIf: true } } as unknown as AppConfig,
    scene: 'simulate',
    view: 'deep',
  });
  workspace.panels.ask = () => setAsking(true);
  return (
    <WorkspaceContext.Provider value={workspace}>
      <DeepDive />
      {asking && (
        <Sheet open onOpenChange={(open) => !open && setAsking(false)}>
          <SheetContent title="Ask" description="Ask about what is on the screen.">
            <p>Nothing to ask about yet.</p>
          </SheetContent>
        </Sheet>
      )}
    </WorkspaceContext.Provider>
  );
}

const frames = (count: number) =>
  act(async () => {
    for (let frame = 0; frame < count; frame += 1)
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  });

// Every control the page asks to take the focus, in order: where the focus is sent matters here, not where it ends,
// because the Ask panel's own focus trap brings it back whenever the page takes it away.
let asked: MockInstance<typeof HTMLElement.prototype.focus>;
beforeEach(() => {
  asked = vi.spyOn(HTMLElement.prototype, 'focus');
});

describe('asking a proxy from its sheet', () => {
  it('leaves the focus with the Ask panel, and does not give it back to the proxy that was opened', async () => {
    const { user } = renderWithApp(<Shell />);
    await user.click(screen.getAllByRole('button', { name: new RegExp(proxy.name, 'u') })[0]!);
    await screen.findByRole('dialog', { name: proxy.name });

    await user.click(
      screen.getByRole('button', { name: new RegExp(`^Ask ${proxy.name.split(' ')[0]}`, 'u') }),
    );
    const ask = await screen.findByRole('dialog', { name: 'Ask' });
    await waitFor(() => expect(ask.contains(document.activeElement)).toBe(true));
    await frames(4);

    // From the moment the panel had the focus, nothing on the page behind it was sent it.
    const targets = asked.mock.contexts as HTMLElement[];
    const took = targets.findIndex((node) => ask.contains(node));
    expect(took).toBeGreaterThanOrEqual(0);
    expect(targets.slice(took).filter((node) => !ask.contains(node))).toEqual([]);
    expect(ask.contains(document.activeElement)).toBe(true);
  });

  it('still gives the focus back to the proxy that was opened when the sheet is closed', async () => {
    const { user } = renderWithApp(<Shell />);
    const opener = screen.getAllByRole('button', { name: new RegExp(proxy.name, 'u') })[0]!;
    await user.click(opener);
    const sheet = await screen.findByRole('dialog', { name: proxy.name });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(sheet.isConnected).toBe(false));
    await frames(2);
    expect(document.activeElement).toBe(opener);
  });
});
