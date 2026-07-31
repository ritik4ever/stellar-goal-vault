export function SkeletonIssueList() {
  return (
    <section className="card" aria-busy="true" aria-label="Loading issue backlog">
      <div className="section-heading">
        <h2>Contribution backlog</h2>
        <p className="muted">Loading open issue ideas...</p>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }} aria-hidden="true">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton" style={{ width: 80, height: 28, borderRadius: 999 }} />
        ))}
      </div>
      <div className="issue-list">
        {Array.from({ length: 3 }).map((_, i) => (
          <article key={i} className="issue-item">
            <div className="issue-topline">
              <div className="skeleton skeleton-line" style={{ width: '60%' }} />
              <div className="skeleton" style={{ width: 50, height: 20, borderRadius: 4 }} />
            </div>
            <div className="skeleton skeleton-line" style={{ width: '80%', marginTop: 8 }} />
            <div className="chip-row" style={{ marginTop: 8 }}>
              <div className="skeleton" style={{ width: 60, height: 24, borderRadius: 999 }} />
              <div className="skeleton" style={{ width: 80, height: 24, borderRadius: 999 }} />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
