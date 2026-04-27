import { CSSProperties, useEffect } from "react";

interface FundedConfettiProps {
  campaignTitle: string;
  onComplete: () => void;
}

const COLORS = ["#f59e0b", "#10b981", "#38bdf8", "#f43f5e", "#8b5cf6", "#fde047"];
const DURATION_MS = 1400;
const PIECES = Array.from({ length: 24 }, (_, index) => ({
  id: index,
  left: 4 + ((index * 17) % 92),
  delay: (index % 6) * 35,
  drift: ((index % 2 === 0 ? 1 : -1) * (24 + (index % 5) * 10)),
  rotation: (index * 39) % 360,
  size: 8 + (index % 4) * 2,
  color: COLORS[index % COLORS.length],
}));

export function FundedConfetti({ campaignTitle, onComplete }: FundedConfettiProps) {
  useEffect(() => {
    const timeoutId = window.setTimeout(onComplete, DURATION_MS);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [onComplete]);

  return (
    <div
      className="funded-confetti-overlay"
      aria-hidden="true"
      data-testid="funded-confetti"
      title={`${campaignTitle} reached its funding target`}
    >
      {PIECES.map((piece) => {
        const style = {
          left: `${piece.left}%`,
          width: `${piece.size}px`,
          height: `${piece.size * 1.8}px`,
          backgroundColor: piece.color,
          animationDelay: `${piece.delay}ms`,
          transform: `translate3d(0, -18vh, 0) rotate(${piece.rotation}deg)`,
          "--confetti-drift": `${piece.drift}px`,
        } as CSSProperties;

        return <span key={piece.id} className="funded-confetti-piece" style={style} />;
      })}
    </div>
  );
}
