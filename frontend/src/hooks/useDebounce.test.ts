import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useDebounce } from "./useDebounce";

describe("useDebounce Hook", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Basic Functionality", () => {
    it("should initialize with the same value as input", () => {
      const { result } = renderHook(() => useDebounce("test", 300));
      expect(result.current).toBe("test");
    });

    it("should debounce value changes", async () => {
      const { result, rerender } = renderHook(
        ({ value }) => useDebounce(value, 300),
        { initialProps: { value: "initial" } }
      );

      expect(result.current).toBe("initial");

      // Change value
      rerender({ value: "updated" });

      // Should still be old value before delay
      expect(result.current).toBe("initial");

      // Fast-forward through delay
      act(() => {
        vi.advanceTimersByTime(300);
      });

      // Now should be updated
      await waitFor(() => {
        expect(result.current).toBe("updated");
      });
    });

    it("should use default delay of 300ms when not specified", async () => {
      const { result, rerender } = renderHook(
        ({ value }) => useDebounce(value),
        { initialProps: { value: "start" } }
      );

      rerender({ value: "end" });

      // 100ms should not be enough
      act(() => {
        vi.advanceTimersByTime(100);
      });

      expect(result.current).toBe("start");

      // 200ms more (total 300ms) should be enough
      act(() => {
        vi.advanceTimersByTime(200);
      });

      await waitFor(() => {
        expect(result.current).toBe("end");
      });
    });

    it("should use custom delay when specified", async () => {
      const { result, rerender } = renderHook(
        ({ value, delay }) => useDebounce(value, delay),
        { initialProps: { value: "initial", delay: 500 } }
      );

      rerender({ value: "updated", delay: 500 });

      // 300ms should not be enough with 500ms delay
      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(result.current).toBe("initial");

      // 200ms more (total 500ms)
      act(() => {
        vi.advanceTimersByTime(200);
      });

      await waitFor(() => {
        expect(result.current).toBe("updated");
      });
    });
  });

  describe("Rapid Changes", () => {
    it("should only apply the last value after rapid changes", async () => {
      const { result, rerender } = renderHook(
        ({ value }) => useDebounce(value, 300),
        { initialProps: { value: "first" } }
      );

      // Make several changes rapidly
      rerender({ value: "second" });
      act(() => {
        vi.advanceTimersByTime(100);
      });

      rerender({ value: "third" });
      act(() => {
        vi.advanceTimersByTime(100);
      });

      rerender({ value: "fourth" });

      // After original delay from first change, still shouldn't update
      // because we keep resetting the timer
      act(() => {
        vi.advanceTimersByTime(100);
      });

      expect(result.current).toBe("first");

      // After full delay from the last change
      act(() => {
        vi.advanceTimersByTime(300);
      });

      await waitFor(() => {
        expect(result.current).toBe("fourth");
      });
    });

    it("should reset timer on each value change", async () => {
      const { result, rerender } = renderHook(
        ({ value }) => useDebounce(value, 300),
        { initialProps: { value: "a" } }
      );

      rerender({ value: "b" });

      // Wait 200ms (not enough)
      act(() => {
        vi.advanceTimersByTime(200);
      });

      expect(result.current).toBe("a");

      // Change again before timer completes
      rerender({ value: "c" });

      // The timer should reset, so we need another 300ms from this point
      act(() => {
        vi.advanceTimersByTime(200);
      });

      expect(result.current).toBe("a");

      // Complete the full 300ms from last change
      act(() => {
        vi.advanceTimersByTime(100);
      });

      await waitFor(() => {
        expect(result.current).toBe("c");
      });
    });
  });

  describe("Different Value Types", () => {
    it("should debounce string values", async () => {
      const { result, rerender } = renderHook(
        ({ value }) => useDebounce(value, 300),
        { initialProps: { value: "search text" } }
      );

      rerender({ value: "updated text" });

      act(() => {
        vi.advanceTimersByTime(300);
      });

      await waitFor(() => {
        expect(result.current).toBe("updated text");
      });
    });

    it("should debounce number values", async () => {
      const { result, rerender } = renderHook(
        ({ value }) => useDebounce(value, 300),
        { initialProps: { value: 42 } }
      );

      rerender({ value: 100 });

      act(() => {
        vi.advanceTimersByTime(300);
      });

      await waitFor(() => {
        expect(result.current).toBe(100);
      });
    });

    it("should debounce boolean values", async () => {
      const { result, rerender } = renderHook(
        ({ value }) => useDebounce(value, 300),
        { initialProps: { value: false } }
      );

      rerender({ value: true });

      act(() => {
        vi.advanceTimersByTime(300);
      });

      await waitFor(() => {
        expect(result.current).toBe(true);
      });
    });

    it("should debounce object values", async () => {
      const obj1 = { name: "first" };
      const obj2 = { name: "second" };

      const { result, rerender } = renderHook(
        ({ value }) => useDebounce(value, 300),
        { initialProps: { value: obj1 } }
      );

      expect(result.current).toBe(obj1);

      rerender({ value: obj2 });

      act(() => {
        vi.advanceTimersByTime(300);
      });

      await waitFor(() => {
        expect(result.current).toBe(obj2);
      });
    });

    it("should debounce array values", async () => {
      const arr1 = [1, 2, 3];
      const arr2 = [4, 5, 6];

      const { result, rerender } = renderHook(
        ({ value }) => useDebounce(value, 300),
        { initialProps: { value: arr1 } }
      );

      rerender({ value: arr2 });

      act(() => {
        vi.advanceTimersByTime(300);
      });

      await waitFor(() => {
        expect(result.current).toBe(arr2);
      });
    });
  });

  describe("Edge Cases", () => {
    it("should handle null values", async () => {
      const { result, rerender } = renderHook(
        ({ value }) => useDebounce(value as string | null, 300),
        { initialProps: { value: "text" } }
      );

      rerender({ value: null });

      act(() => {
        vi.advanceTimersByTime(300);
      });

      await waitFor(() => {
        expect(result.current).toBeNull();
      });
    });

    it("should handle undefined values", async () => {
      const { result, rerender } = renderHook(
        ({ value }) => useDebounce(value as string | undefined, 300),
        { initialProps: { value: "text" } }
      );

      rerender({ value: undefined });

      act(() => {
        vi.advanceTimersByTime(300);
      });

      await waitFor(() => {
        expect(result.current).toBeUndefined();
      });
    });

    it("should handle empty strings", async () => {
      const { result, rerender } = renderHook(
        ({ value }) => useDebounce(value, 300),
        { initialProps: { value: "text" } }
      );

      rerender({ value: "" });

      act(() => {
        vi.advanceTimersByTime(300);
      });

      await waitFor(() => {
        expect(result.current).toBe("");
      });
    });

    it("should handle zero values", async () => {
      const { result, rerender } = renderHook(
        ({ value }) => useDebounce(value, 300),
        { initialProps: { value: 42 } }
      );

      rerender({ value: 0 });

      act(() => {
        vi.advanceTimersByTime(300);
      });

      await waitFor(() => {
        expect(result.current).toBe(0);
      });
    });
  });

  describe("Cleanup", () => {
    it("should cleanup timeout on unmount", () => {
      const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");

      const { unmount, rerender } = renderHook(
        ({ value }) => useDebounce(value, 300),
        { initialProps: { value: "test" } }
      );

      rerender({ value: "updated" });

      unmount();

      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
    });

    it("should cleanup previous timeout when value changes", () => {
      const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");

      const { rerender } = renderHook(
        ({ value }) => useDebounce(value, 300),
        { initialProps: { value: "a" } }
      );

      rerender({ value: "b" });
      rerender({ value: "c" });

      // Should have called clearTimeout for each previous change
      expect(clearTimeoutSpy.mock.calls.length).toBeGreaterThanOrEqual(2);

      clearTimeoutSpy.mockRestore();
    });
  });

  describe("Search Use Case", () => {
    it("should simulate typing a search query (campaign vault scenario)", async () => {
      const { result, rerender } = renderHook(
        ({ value }) => useDebounce(value, 300),
        { initialProps: { value: "" } }
      );

      // User types: "r"
      rerender({ value: "r" });
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(result.current).toBe("");

      // User types: "o" (before first debounce completes)
      rerender({ value: "ro" });
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(result.current).toBe("");

      // User types: "c"
      rerender({ value: "roc" });
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(result.current).toBe("");

      // User types: "k"
      rerender({ value: "rock" });
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(result.current).toBe("");

      // Wait for debounce to complete
      act(() => {
        vi.advanceTimersByTime(200);
      });

      await waitFor(() => {
        expect(result.current).toBe("rock");
      });
    });

    it("should perform efficient debouncing for multiple searches", async () => {
      const { result, rerender } = renderHook(
        ({ value, delay }) => useDebounce(value, delay),
        { initialProps: { value: "initial", delay: 300 } }
      );

      // First search
      rerender({ value: "search1", delay: 300 });
      act(() => {
        vi.advanceTimersByTime(300);
      });

      await waitFor(() => {
        expect(result.current).toBe("search1");
      });

      // Second search before waiting
      rerender({ value: "search2", delay: 300 });
      act(() => {
        vi.advanceTimersByTime(150);
      });

      expect(result.current).toBe("search1");

      // Complete second debounce
      act(() => {
        vi.advanceTimersByTime(150);
      });

      await waitFor(() => {
        expect(result.current).toBe("search2");
      });
    });
  });

  describe("Delay Changes", () => {
    it("should respect delay changes", async () => {
      const { result, rerender } = renderHook(
        ({ value, delay }) => useDebounce(value, delay),
        { initialProps: { value: "initial", delay: 300 } }
      );

      rerender({ value: "updated", delay: 500 });

      // 300ms not enough for 500ms delay
      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(result.current).toBe("initial");

      // 200ms more = 500ms total
      act(() => {
        vi.advanceTimersByTime(200);
      });

      await waitFor(() => {
        expect(result.current).toBe("updated");
      });
    });

    it("should handle decreasing delay", async () => {
      const { result, rerender } = renderHook(
        ({ value, delay }) => useDebounce(value, delay),
        { initialProps: { value: "initial", delay: 500 } }
      );

      rerender({ value: "updated", delay: 500 });

      act(() => {
        vi.advanceTimersByTime(300);
      });

      // Change to shorter delay
      rerender({ value: "final", delay: 100 });

      expect(result.current).toBe("initial");

      // After 100ms with new delay
      act(() => {
        vi.advanceTimersByTime(100);
      });

      await waitFor(() => {
        expect(result.current).toBe("final");
      });
    });
  });
});
