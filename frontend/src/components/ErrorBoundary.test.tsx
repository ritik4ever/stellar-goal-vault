import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

function Bomb(): React.ReactElement {
  throw new Error('test render error');
}

function Fine(): React.ReactElement {
  return <div>all good</div>;
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary componentName="Fine">
        <Fine />
      </ErrorBoundary>,
    );

    expect(screen.getByText('all good')).toBeTruthy();
  });

  it('shows fallback UI when a child throws', () => {
    render(
      <ErrorBoundary componentName="Bomb">
        <Bomb />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(/Something went wrong in Bomb/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
  });

  it('logs the error to console.error with the component name', () => {
    render(
      <ErrorBoundary componentName="Bomb">
        <Bomb />
      </ErrorBoundary>,
    );

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('[ErrorBoundary] Error in Bomb:'),
      expect.any(Error),
      expect.anything(),
    );
  });

  it('resets error state when Try again is clicked', () => {
    let shouldThrow = true;

    function Conditional(): React.ReactElement {
      if (shouldThrow) throw new Error('boom');
      return <div>recovered</div>;
    }

    const { rerender } = render(
      <ErrorBoundary componentName="Conditional">
        <Conditional />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toBeTruthy();

    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));

    rerender(
      <ErrorBoundary componentName="Conditional">
        <Conditional />
      </ErrorBoundary>,
    );

    expect(screen.getByText('recovered')).toBeTruthy();
  });
});
