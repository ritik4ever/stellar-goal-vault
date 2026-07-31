export function SkeletonAnalytics() {
  return (
    <div className="creator-metrics-container" aria-busy="true" aria-label="Loading creator analytics">
      <div className="skeleton skeleton-line" style={{ width: 300, height: 20, marginBottom: 24 }} />
      <div className="metric-grid">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="metric-card">
            <div className="skeleton skeleton-line" style={{ width: 120 }} />
            <div className="skeleton skeleton-line" style={{ width: 40, height: 20, marginTop: 8 }} />
          </div>
        ))}
      </div>
      <div style={{ marginTop: 32 }} aria-hidden="true">
        <div className="skeleton skeleton-line" style={{ width: 200, height: 16, marginBottom: 16 }} />
        <div className="skeleton" style={{ width: '100%', height: 300, borderRadius: 8 }} />
      </div>
      <div style={{ marginTop: 32 }} aria-hidden="true">
        <div className="skeleton skeleton-line" style={{ width: 200, height: 16, marginBottom: 16 }} />
        <div className="skeleton" style={{ width: '100%', height: 300, borderRadius: 8 }} />
      </div>
    </div>
  );
}
