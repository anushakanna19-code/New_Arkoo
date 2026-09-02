import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary] Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          padding: '2rem',
          fontFamily: 'system-ui, sans-serif',
          backgroundColor: '#0f172a',
          color: '#e2e8f0',
        }}>
          <div style={{
            maxWidth: '480px',
            textAlign: 'center',
            padding: '2rem',
            borderRadius: '12px',
            backgroundColor: '#1e293b',
            border: '1px solid #334155',
          }}>
            <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem', color: '#f97316' }}>
              Something went wrong
            </h2>
            <p style={{ fontSize: '0.875rem', color: '#94a3b8', marginBottom: '1.5rem', lineHeight: 1.6 }}>
              An unexpected error occurred. Please refresh the page or contact support if the issue persists.
            </p>
            <pre style={{
              fontSize: '0.75rem',
              backgroundColor: '#0f172a',
              padding: '1rem',
              borderRadius: '8px',
              overflow: 'auto',
              maxHeight: '120px',
              color: '#f87171',
              textAlign: 'left',
              marginBottom: '1.5rem',
            }}>
              {this.state.error?.message || 'Unknown error'}
            </pre>
            <button
              onClick={() => window.location.reload()}
              style={{
                backgroundColor: '#f97316',
                color: '#ffffff',
                border: 'none',
                padding: '10px 24px',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '0.875rem',
              }}
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
