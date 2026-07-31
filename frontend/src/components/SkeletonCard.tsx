export function SkeletonCard() {
  return (
    <article className="campaign-card">
      <div className="campaign-card-main">
        <div className="campaign-card-header">
          <div className="skeleton skeleton-line" style={{ width: '75%', height: 24 }} />
          <div className="skeleton skeleton-line" style={{ width: '25%', height: 24 }} />
        </div>
        <div
          className="campaign-creator mono"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: 12,
          }}
        >
          <div className="skeleton" style={{ width: 24, height: 24, borderRadius: '50%' }} />
          <div className="skeleton skeleton-line" style={{ flex: 1 }} />
        </div>
        <div className="campaign-progress">
          <div className="skeleton skeleton-line" style={{ width: '100%', marginBottom: 8 }} />
          <div className="skeleton skeleton-line" style={{ width: '50%' }} />
        </div>
        <div className="campaign-meta">
          <div className="skeleton skeleton-line" style={{ width: '33%' }} />
        </div>
      </div>
      <div className="campaign-card-actions">
        <div className="skeleton" style={{ height: 40, borderRadius: 8 }} />
      </div>
    </article>
  );
}
