import { useEffect, useState } from 'react';

interface CountdownProps {
  deadline: number;
}

interface TimeLeft {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

function calc(deadline: number): TimeLeft | null {
  const diff = deadline * 1000 - Date.now();
  if (diff <= 0) return null;
  const total = Math.floor(diff / 1000);
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

export function Countdown({ deadline }: CountdownProps) {
  const [tl, setTl] = useState<TimeLeft | null>(() => calc(deadline));

  useEffect(() => {
    setTl(calc(deadline));
    const id = setInterval(() => {
      setTl(calc(deadline));
    }, 1000);
    return () => clearInterval(id);
  }, [deadline]);

  if (tl === null) {
    return <span className="countdown-expired">Deadline Passed</span>;
  }

  const urgent = tl.days === 0 && tl.hours < 24;
  const cls = urgent ? 'countdown-urgent' : 'countdown';

  return (
    <span className={cls}>
      {tl.days > 0 && <>{tl.days}d </>}
      {pad(tl.hours)}h {pad(tl.minutes)}m {pad(tl.seconds)}s
    </span>
  );
}
