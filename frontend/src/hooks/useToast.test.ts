import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useToast } from "./useToast";

describe("useToast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts with no toasts", () => {
    const { result } = renderHook(() => useToast());
    expect(result.current.toasts).toHaveLength(0);
  });

  it("adds a toast with the given message and variant", () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.addToast("Pledge confirmed.", "success");
    });

    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].message).toBe("Pledge confirmed.");
    expect(result.current.toasts[0].variant).toBe("success");
  });

  it("defaults to info variant when none supplied", () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.addToast("Something happened.");
    });

    expect(result.current.toasts[0].variant).toBe("info");
  });

  it("stacks multiple toasts", () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.addToast("First", "success");
      result.current.addToast("Second", "error");
      result.current.addToast("Third", "info");
    });

    expect(result.current.toasts).toHaveLength(3);
  });

  it("auto-dismisses after 4500 ms", () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.addToast("Will vanish", "success");
    });

    expect(result.current.toasts).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(4500);
    });

    expect(result.current.toasts).toHaveLength(0);
  });

  it("manually dismissing removes only the targeted toast", () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.addToast("Keep me", "success");
      result.current.addToast("Remove me", "error");
    });

    const idToRemove = result.current.toasts[1].id;

    act(() => {
      result.current.dismiss(idToRemove);
    });

    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].message).toBe("Keep me");
  });
});
