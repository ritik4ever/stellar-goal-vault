import { ListTodo } from "lucide-react";
import { OpenIssue } from "../types/campaign";
import { EmptyState } from "./EmptyState";

interface IssueBacklogProps {
  issues: OpenIssue[];
  isLoading?: boolean;
}

export function IssueBacklog({ issues, isLoading = false }: IssueBacklogProps) {
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

  return (
    <section className="card">
      <div className="section-heading">
        <h2>Contribution backlog</h2>
        <p className="muted">
          Ready-to-open issue ideas for your public repo after you push it.
        </p>
      </div>

      <div className="issue-list">
        {issues.map((issue) => (
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
