import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  componentName: string;
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error(`[ErrorBoundary] Error in ${this.props.componentName}:`, error, info);
  }

  private handleRetry = (): void => {
    this.setState({ hasError: false });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="error-boundary-fallback" role="alert">
          <p>Something went wrong in {this.props.componentName}.</p>
          <button className="btn-ghost" type="button" onClick={this.handleRetry}>
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
