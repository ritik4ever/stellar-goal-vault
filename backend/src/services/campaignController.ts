// src/controllers/campaignController.ts

const VALID_SORT_FIELDS = ['createdAt', 'deadline', 'pledgedAmount', 'percentFunded'];
const VALID_ORDERS = ['asc', 'desc'];

export const getCampaigns = async (req, res) => {
  const { sortBy = 'createdAt', order = 'desc' } = req.query;

  // Acceptance Criteria: Invalid sort values return 400
  if (!VALID_SORT_FIELDS.includes(sortBy) || !VALID_ORDERS.includes(order)) {
    return res.status(400).json({ 
      error: "Invalid sort field or order. Use: createdTime, deadline, pledgedAmount, or percentFunded." 
    });
  }

  // Logic: Stability when combined with filters
  const campaigns = await CampaignService.findAll({
    where: req.filters, // Existing filters
    order: [[sortBy, order]],
  });

  res.json(campaigns);
//  Define allowed values for Acceptance Criteria
};

