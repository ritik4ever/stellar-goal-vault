import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getCampaign } from '../services/api';
import type { Campaign } from '../types/campaign';

interface UseCampaignResult {
  campaign: Campaign | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

/**
 * Loads a single campaign's detail view.
 *
 * The in-flight request is shared so that repeated renders (or a refetch
 * triggered while a load is already running) do not issue duplicate network
 * calls for the same campaign id.
 */
export function useCampaign(campaignId: string | undefined): UseCampaignResult {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(campaignId));
  const [error, setError] = useState<Error | null>(null);

  // Tracks the in-flight load so concurrent callers reuse the same promise
  // instead of firing duplicate requests for the same campaign id.
  const inFlightRef = useRef<{
    id: string;
    promise: Promise<void>;
  } | null>(null);

  const load = useCallback(async (id: string): Promise<void> => {
    const inFlight = inFlightRef.current;
    if (inFlight && inFlight.id === id) {
      return inFlight.promise;
    }

    // Declared before the async IIFE so the `finally` block below can compare
    // the in-flight entry against this exact promise. `prefer-const` is
    // suppressed because the promise is referenced from its own initializer.
    let promise!: Promise<void>;
    // eslint-disable-next-line prefer-const -- referenced from its own initializer
    promise = (async () => {
      setLoading(true);
      setError(null);
      try {
        const campaignData = await getCampaign(id);
        setCampaign(campaignData);
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        setLoading(false);
        if (inFlightRef.current?.promise === promise) {
          inFlightRef.current = null;
        }
      }
    })();

    inFlightRef.current = { id, promise };
    return promise;
  }, []);

  useEffect(() => {
    if (!campaignId) {
      setCampaign(null);
      setLoading(false);
      setError(null);
      return;
    }

    void load(campaignId);
  }, [campaignId, load]);

  const refetch = useCallback(async (): Promise<void> => {
    if (!campaignId) {
      return;
    }
    // Force a fresh load on explicit refetch by clearing any shared request.
    inFlightRef.current = null;
    await load(campaignId);
  }, [campaignId, load]);

  return useMemo(
    () => ({ campaign, loading, error, refetch }),
    [campaign, loading, error, refetch],
  );
}
