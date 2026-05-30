import React, { useState } from "react";
interface Props { src: string; alt: string; className?: string; }
const LazyImage: React.FC<Props> = ({ src, alt, className }) => {
  const [loaded, setLoaded] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      {!loaded && <div style={{ position: "absolute", inset: 0, background: "#1e293b", borderRadius: 8 }} />}
      <img src={src} alt={alt} className={className} loading="lazy" onLoad={() => setLoaded(true)} style={{ opacity: loaded ? 1 : 0, transition: "opacity 0.3s" }} />
    </div>
  );
};
export default LazyImage;
