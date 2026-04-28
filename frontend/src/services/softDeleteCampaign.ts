import { softDeleteCampaign } from './api';

export async function handleSoftDelete(campaignId: string) {
  try {
    await softDeleteCampaign(campaignId);
  } catch (error) {
    console.error('Soft delete failed', error);
  }
}
