import { useState } from 'react';
import { ListTodo, X } from 'lucide-react';
import { OpenIssue } from '../types/campaign';
import { EmptyState } from './EmptyState';

interface IssueBacklogProps {
  issues: OpenIssue[];
  isLoading?: boolean;
}

export function IssueBacklog({ issues, isLoading = false }: IssueBacklogProps) {
  const [activeLabels, setActiveLabels] = useState<string[]>([]);

  if (isLoading) {
    return (
      <section className="card">
        <div className="section-heading">
          <h2>Contribution backlog</h2>
          <p className="muted">Loading open issue ideas...</p>
        </div>
      </section>
    );
  }

  if (issues.length === 0) {
    return (
      <EmptyState
        variant="card"
        icon={ListTodo}
        title="Contribution backlog"
        message="No seeded issues are available right now."
      />
    );
  }

  const allLabels = Array.from(new Set(issues.flatMap(issue => issue.labels))).sort();

  const toggleLabel = (label: string) => {
    setActiveLabels(prev => 
      prev.includes(label) ? prev.filter(l => l !== label) : [...prev, label]
    );
  };

  const filteredIssues = activeLabels.length === 0
    ? issues
    : issues.filter(issue => issue.labels.some(label => activeLabels.includes(label)));

  return (
    <section className="card">
      <div className="section-heading">
        <h2>Contribution backlog</h2>
        <p className="muted">Ready-to-open issue ideas for your public repo after you push it.</p>
      </div>

      {allLabels.length > 0 && (
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px', alignItems: 'center' }}>
          {allLabels.map(label => (
            <button
              key={label}
              onClick={() => toggleLabel(label)}
              className={`chip ${activeLabels.includes(label) ? 'active' : ''}`}
              style={{
                cursor: 'pointer',
                border: activeLabels.includes(label) ? '2px solid var(--primary-accent)' : '1px solid var(--border-color)',
                backgroundColor: activeLabels.includes(label) ? 'var(--primary-subtle)' : 'transparent',
                outline: 'none'
              }}
            >
              {label}
            </button>
          ))}
          {activeLabels.length > 0 && (
            <button 
              onClick={() => setActiveLabels([])}
              className="control-button"
              style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 8px', fontSize: '0.85rem' }}
            >
              <X size={14} /> Clear all
            </button>
          )}
        </div>
      )}

      <div className="issue-list">
        {filteredIssues.map((issue) => (
          <article key={issue.id} className="issue-item">
            <div className="issue-topline">
              <strong>
                #{issue.id} {issue.title}
              </strong>
              <span className="chip-emphasis">{issue.points} pts</span>
            </div>
            <p className="muted">{issue.summary}</p>
            <div className="chip-row">
              <span className="chip">{issue.complexity}</span>
              {issue.labels.map((label) => (
                <span key={label} className="chip">
                  {label}
                </span>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
