import { softDeleteCampaign } from './api';
import { refreshCampaigns } from '../App';

export async function handleSoftDelete(campaignId: string) {
  try {
    await softDeleteCampaign(campaignId);
    await refreshCampaigns();
  } catch (error) {
    console.error('Soft delete failed', error);
  }
}
