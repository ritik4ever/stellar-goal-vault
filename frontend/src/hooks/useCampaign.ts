import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getCampaign, getCampaignStats } from '../services/campaignService';
import type { Campaign, CampaignStats } from '../types/campaign';

interface UseCampaignResult {
  campaign: Campaign | null;
  stats: CampaignStats | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

/**
 * Loads a single campaign's detail view.
 *
 * The detail view needs both the campaign record and its stats. These are
 * fetched together and the in-flight request is shared so that repeated
 * renders (or a refetch triggered while a load is already running) do not
 * issue duplicate network calls for the same campaign id.
 */
export function useCampaign(campaignId: string | undefined): UseCampaignResult {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [stats, setStats] = useState<CampaignStats | null>(null);
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

    const promise = (async () => {
      setLoading(true);
      setError(null);
      try {
        const [campaignData, statsData] = await Promise.all([
          getCampaign(id),
          getCampaignStats(id),
        ]);
        setCampaign(campaignData);
        setStats(statsData);
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
      setStats(null);
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
    () => ({ campaign, stats, loading, error, refetch }),
    [campaign, stats, loading, error, refetch],
  );
}
