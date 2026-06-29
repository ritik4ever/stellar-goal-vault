export function SkeletonCard() {
  return (
    <article className="campaign-card animate-pulse">
      <div className="campaign-card-main">
        <div className="campaign-card-header">
          <div className="h-6 bg-gray-300 rounded w-3/4 mb-2"></div>
          <div className="h-6 bg-gray-300 rounded w-1/4"></div>
        </div>
        <div
          className="campaign-creator mono"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 12,
          }}
        >
          <div className="h-6 w-6 bg-gray-300 rounded-full"></div>
          <div className="h-6 bg-gray-300 rounded flex-1"></div>
        </div>
        <div className="campaign-progress">
          <div className="h-4 bg-gray-300 rounded w-full mb-2"></div>
          <div className="h-4 bg-gray-300 rounded w-1/2"></div>
        </div>
        <div className="campaign-meta">
          <div className="h-4 bg-gray-300 rounded w-1/3"></div>
        </div>
      </div>
      <div className="campaign-card-actions">
        <div className="h-10 bg-gray-300 rounded w-full"></div>
      </div>
    </article>
  );
}
