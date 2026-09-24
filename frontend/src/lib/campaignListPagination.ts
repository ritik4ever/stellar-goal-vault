import type { Campaign } from '../types/campaign';

/**
 * Merges a newly fetched page of campaigns into the chunks already loaded.
 *
 * The campaign board loads one bounded page at a time. Because later pages are
 * requested by numeric `page`/`limit` offsets, a campaign can legitimately
 * reappear in a later chunk (for example when its pledged amount changes and it
 * shifts across a page boundary). Appending such a row twice would produce
 * duplicate React keys and a duplicated list entry, so ids that are already
 * present are dropped.
 *
 * Ordering is preserved: previously loaded campaigns keep their position and
 * only genuinely new campaigns are appended, in the order the API returned them.
 * This keeps the visible list in sync with the server's stable ordering as
 * subsequent chunks arrive.
 *
 * @param current - Campaigns already loaded and rendered.
 * @param incoming - The next page of campaigns returned by the API.
 * @returns A new array containing `current` followed by the unseen `incoming` rows.
 */
export function appendUniqueCampaigns(current: Campaign[], incoming: Campaign[]): Campaign[] {
  if (incoming.length === 0) {
    return current;
  }

  const seen = new Set(current.map((campaign) => campaign.id));
  const unseen = incoming.filter((campaign) => !seen.has(campaign.id));

  if (unseen.length === 0) {
    return current;
  }

  return [...current, ...unseen];
}
