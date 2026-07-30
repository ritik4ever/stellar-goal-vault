interface CountdownProps {
  hoursLeft: number;
  deadline?: number;
}

export function Countdown({ hoursLeft }: CountdownProps) {
  let display: string;
  if (hoursLeft <= 0) {
    display = 'Ended';
  } else if (hoursLeft < 24) {
    display = `${hoursLeft}h left`;
  } else {
    const days = Math.floor(hoursLeft / 24);
    const hours = hoursLeft % 24;
    display = `${days}d ${hours}h left`;
  }
  return <div className="muted">{display}</div>;
}
