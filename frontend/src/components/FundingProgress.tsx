import React, { useState, useEffect } from 'react';
import { FundedConfetti } from './FundedConfetti';

export interface FundingProgressProps {
  currentAmount: number;
  targetAmount: number;
  campaignTitle?: string;
}

export function FundingProgress({
  currentAmount,
  targetAmount,
  campaignTitle = 'Campaign',
}: FundingProgressProps) {
  // Ensure percentage is between 0 and 100
  const percentage = Math.min(
    100,
    Math.max(0, targetAmount > 0 ? (currentAmount / targetAmount) * 100 : 0)
  );
  const isFunded = percentage >= 100;

  const [hasCelebrated, setHasCelebrated] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);

  useEffect(() => {
    if (isFunded && !hasCelebrated) {
      setShowConfetti(true);
      setHasCelebrated(true);
    }
  }, [isFunded, hasCelebrated]);

  // Blue hue is ~220, Green hue is ~140. We transition hue from 220 down to 140.
  const hue = 220 - (percentage / 100) * 80;
  const barStyle = {
    width: `${percentage}%`,
    backgroundColor: `hsl(${hue}, 85%, 50%)`,
    transition: 'width 0.5s ease-out, background-color 0.5s ease-out',
  };

  const markers = [25, 50, 75, 100];

  return (
    <div className="w-full" data-testid="funding-progress">
      <div className="relative w-full h-4 bg-gray-200 rounded-full overflow-hidden">
        <div
          className="absolute top-0 left-0 h-full rounded-full"
          style={barStyle}
          data-testid="progress-bar"
        />
        {markers.map((marker) => (
          <div
            key={marker}
            className="absolute top-0 bottom-0 border-l-2 border-white/50 z-10"
            style={{ left: `${marker}%` }}
            data-testid={`marker-${marker}`}
          />
        ))}
      </div>
      {showConfetti && (
        <FundedConfetti
          campaignTitle={campaignTitle}
          onComplete={() => setShowConfetti(false)}
        />
      )}
    </div>
  );
}
