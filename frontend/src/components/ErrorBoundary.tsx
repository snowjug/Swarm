import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Swarm Lab rendering error', error, info.componentStack);
  }

  render() {
    if (this.state.failed) {
      return (
        <main className="fatal-error">
          <div className="empty-icon">
            <AlertTriangle size={27} aria-hidden="true" />
          </div>
          <span className="eyebrow">WORKBENCH INTERRUPTED</span>
          <h1>Something didn’t render correctly.</h1>
          <p>
            Your saved projects are held by the local server. Reload the workbench to reconnect. If
            this happens again, check the browser console and server output.
          </p>
          <button
            className="button button-primary"
            type="button"
            onClick={() => window.location.reload()}
          >
            <RefreshCw size={16} aria-hidden="true" /> Reload workbench
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}
