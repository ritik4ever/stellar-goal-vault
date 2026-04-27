import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { FundedConfetti } from "./FundedConfetti";

describe("FundedConfetti", () => {
  it("renders a non-blocking burst and cleans up after a short delay", () => {
    vi.useFakeTimers();
    const onComplete = vi.fn();

    render(<FundedConfetti campaignTitle="Orbit Fund" onComplete={onComplete} />);

    expect(screen.getByTestId("funded-confetti")).toBeInTheDocument();

    vi.advanceTimersByTime(1400);

    expect(onComplete).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
