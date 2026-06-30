import { useCallback, useRef, useState } from 'react';

export type ToastVariant = 'success' | 'error' | 'info';

export interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
  /** Optional URL rendered as a "View" link inside the toast. */
  link?: { href: string; label: string };
}

const AUTO_DISMISS_MS = 6000;

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const addToast = useCallback(
    (
      message: string,
      variant: ToastVariant = 'info',
      link?: { href: string; label: string },
    ) => {
      const id = crypto.randomUUID();
      setToasts((prev) => [...prev, { id, message, variant, link }]);
      // Give the user more time to click the link when one is present.
      const delay = link ? 10_000 : AUTO_DISMISS_MS;
      const timer = setTimeout(() => dismiss(id), delay);
      timersRef.current.set(id, timer);
    },
    [dismiss],
  );

  return { toasts, addToast, dismiss };
}
