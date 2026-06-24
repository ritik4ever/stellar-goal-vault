import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <div className="app-shell">
      <section className="hero animate-fade-in">
        <div className="hero-topline">
          <div>
            <div className="eyebrow">404 — Not Found</div>
            <h1>Campaign not found</h1>
          </div>
        </div>
        <p className="hero-copy">
          The campaign you&apos;re looking for doesn&apos;t exist or may have been removed.
        </p>
        <Link to="/" className="btn-primary" style={{ display: "inline-block", marginTop: 16 }}>
          Back to campaigns
        </Link>
      </section>
    </div>
  );
}
