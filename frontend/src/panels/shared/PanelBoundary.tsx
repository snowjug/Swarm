import { Component } from 'react';
import type { ReactNode } from 'react';

/**
 * Keeps a panel that cannot be drawn (its code did not arrive, or it failed on what it was given) from taking the
 * page with it: the page behind is fine, and so is the exploration. It draws nothing in the panel's place and tells
 * its owner, who says so and lets the panel go.
 */
export class PanelBoundary extends Component<
  { onFail: (error: Error) => void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    console.error('Swarm panel rendering error', error);
    this.props.onFail(error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
