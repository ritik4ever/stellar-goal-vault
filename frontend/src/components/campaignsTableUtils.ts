import type { Campaign } from "../types/campaign";
import type { SortOption } from "./SortDropdown";

/**
 * Returns sorted, deduplicated assetCode values from the given campaigns.
 */
export function getDistinctAssetCodes(campaigns: Campaign[]): string[] {
  return [...new Set(campaigns.map((c) => c.assetCode))].sort();
}

/**
 * Filters campaigns by search query
 *
 * Searches across:
 * - campaign.title (partial match, case-insensitive)
 * - campaign.creator (case-insensitive)
 * - campaign.id (partial match, case-insensitive)
 *
 * @param campaigns - Array of campaigns to search
 * @param searchQuery - Search query string (empty string skips search)
 * @returns Filtered campaigns matching the search query
 */
export function searchCampaigns(
  campaigns: Campaign[],
  searchQuery: string,
): Campaign[] {
  // Skip filtering if search query is empty or only whitespace
  if (!searchQuery || searchQuery.trim() === "") {
    return campaigns;
  }

  // Normalize search query: lowercase and trim whitespace
  const normalizedQuery = searchQuery.trim().toLowerCase();

  return campaigns.filter((campaign) => {
    // Check title (partial match)
    const titleMatches = campaign.title.toLowerCase().includes(normalizedQuery);

    // Check creator address (case-insensitive)
    const creatorMatches = campaign.creator.toLowerCase().includes(normalizedQuery);

    // Check campaign ID (partial match, case-insensitive)
    const idMatches = campaign.id.toLowerCase().includes(normalizedQuery);

    // Match if any field matches
    return titleMatches || creatorMatches || idMatches;
  });
}

/**
 * Pure function that applies asset code, search, and status predicates to a campaign list.
 * Pass "" as assetCode or status to skip that filter.
 * Pass "" as searchQuery to skip search.
 *
 * Filter composition (AND logic):
 * - Must match search query (if provided)
 * - AND must match asset code (if provided)
 * - AND must match status (if provided)
 */
export function applyFilters(
  campaigns: Campaign[],
  assetCode: string,
  status: string,
  searchQuery: string = "",
): Campaign[] {
  // Apply filters in sequence
  let filtered = searchCampaigns(campaigns, searchQuery);

  filtered = filtered.filter((c) => {
    const matchesAsset = assetCode === "" || c.assetCode === assetCode;
    const matchesStatus = status === "" || c.progress.status === status;
    return matchesAsset && matchesStatus;
  });

  return filtered;
}

/**
 * Sorts campaigns by the specified sort option.
 * 
 * Sorting is stable - campaigns with equal sort values maintain their original order.
 * This ensures the selected campaign state is preserved during sorting.
 * 
 * @param campaigns - Array of campaigns to sort
 * @param sortBy - Sort option (newest, deadline, percentFunded, totalPledged)
 * @returns Sorted array of campaigns
 */
export function sortCampaigns(
  campaigns: Campaign[],
  sortBy: SortOption,
): Campaign[] {
  // Create a copy to avoid mutating the original array
  const sorted = [...campaigns];
  
  sorted.sort((a, b) => {
    let comparison = 0;
    
    switch (sortBy) {
      case "newest":
        // Sort by createdAt descending (newest first)
        comparison = b.createdAt - a.createdAt;
        break;
      
      case "deadline":
        // Sort by deadline ascending (nearest deadline first)
        comparison = a.deadline - b.deadline;
        break;
      
      case "percentFunded":
        // Sort by percentFunded descending (highest first)
        comparison = b.progress.percentFunded - a.progress.percentFunded;
        break;
      
      case "totalPledged":
        // Sort by pledgedAmount descending (largest first)
        comparison = b.pledgedAmount - a.pledgedAmount;
        break;
      
      default:
        // No sorting for unknown options
        comparison = 0;
    }
    
    return comparison;
  });
  
  return sorted;
}
