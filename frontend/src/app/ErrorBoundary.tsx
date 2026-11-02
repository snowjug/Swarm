import { Component, createRef } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { House, RotateCw, TriangleAlert } from 'lucide-react';
import { Aurora } from '../design/ambient/Aurora';
import { Mark } from '../design/ui/Mark';
import '../panels/standalone.css';

interface State {
  error: Error | null;
}

/**
 * The last thing standing when a screen fails to render. It sits outside every provider, so it is plain
 * markup in the design's own classes: nothing here can fail for the reason the screen just did. The
 * saved work is on the server, so the way out is to read it again, or to start from the front door.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };
  private heading = createRef<HTMLHeadingElement>();

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Swarm Lab rendering error', error, info.componentStack);
  }

  componentDidMount() {
    if (this.state.error) this.announce();
  }

  componentDidUpdate(_: unknown, before: State) {
    if (this.state.error && !before.error) this.announce();
  }

  /** A failure replaces the whole page, so the page's heading is where focus goes, and the tab says it too. */
  private announce() {
    document.title = 'Something went wrong · Swarm';
    this.heading.current?.focus();
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const message = error.message.trim().slice(0, 600);
    return (
      <>
        <Aurora />
        <div className="sw-stand">
          <header className="sw-stand__brand">
            <Mark size={26} />
            <span className="sw-stand__word">Swarm</span>
          </header>
          <main id="main-content" className="sw-stand__main">
            <div className="sw-stand__card sw-glass sw-glass--overlay sw-rise" data-tone="critical">
              <span className="sw-stand__badge" aria-hidden="true">
                <TriangleAlert size={22} />
              </span>
              <h1 ref={this.heading} className="sw-stand__title" tabIndex={-1}>
                Something didn’t render correctly.
              </h1>
              <p className="sw-stand__text">
                Your saved projects are held by the server. Reload to reconnect.
              </p>
              <div className="sw-stand__actions">
                <button
                  type="button"
                  className="sw-btn sw-btn--primary sw-btn--lg"
                  onClick={() => window.location.reload()}
                >
                  <RotateCw size={18} aria-hidden="true" />
                  <span className="sw-btn__label">Reload</span>
                </button>
                <a className="sw-btn sw-btn--glass sw-btn--lg" href="/">
                  <House size={18} aria-hidden="true" />
                  <span className="sw-btn__label">Start over</span>
                </a>
              </div>
              {message && (
                <details className="sw-stand__details">
                  <summary>Technical details</summary>
                  <pre>{message}</pre>
                </details>
              )}
            </div>
          </main>
        </div>
      </>
    );
  }
}
