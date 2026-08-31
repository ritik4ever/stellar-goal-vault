export function SkeletonTimeline() {
  return (
    <section className="card" aria-busy="true" aria-label="Loading timeline">
      <div className="section-heading">
        <h2>Timeline</h2>
        <p className="muted">Loading campaign activity...</p>
      </div>
      <div className="timeline-progress-wrap" aria-hidden="true">
        <div className="skeleton" style={{ height: 8, borderRadius: 4, width: '60%' }} />
      </div>
      <div className="timeline">
        {Array.from({ length: 4 }).map((_, i) => (
          <article key={i} className="timeline-item" aria-hidden="true">
            <div className="timeline-dot skeleton" style={{ width: 12, height: 12, borderRadius: '50%' }} />
            <div className="timeline-copy">
              <div className="skeleton skeleton-line" style={{ width: 160 }} />
              <div className="skeleton skeleton-line" style={{ width: 200, marginTop: 4 }} />
              <div className="skeleton skeleton-line" style={{ width: 120, marginTop: 4 }} />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
