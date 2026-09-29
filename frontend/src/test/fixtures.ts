import { faker } from '@faker-js/faker';
import { v4 as uuidv4 } from 'uuid';

// Types for our domain entities
type CampaignStatus = 'draft' | 'active' | 'funded' | 'expired' | 'failed';
type PledgeStatus = 'pending' | 'confirmed' | 'cancelled' | 'refunded';

interface Campaign {
  id: string;
  title: string;
  description: string;
  goalAmount: number;
  currentAmount: number;
  status: CampaignStatus;
  createdAt: Date;
  endDate: Date;
  ownerId: string;
}

interface Pledge {
  id: string;
  campaignId: string;
  userId: string;
  amount: number;
  status: PledgeStatus;
  createdAt: Date;
}

interface User {
  id: string;
  name: string;
  email: string;
  walletAddress: string;
}

// Deterministic time helpers
const FIXED_NOW = new Date('2023-01-01T00:00:00.000Z');

export const createFixedDate = (offsetDays: number = 0): Date => {
  const date = new Date(FIXED_NOW);
  date.setDate(date.getDate() + offsetDays);
  return date;
};

// User Fixtures
export const createMockUser = (overrides: Partial<User> = {}): User => ({
  id: uuidv4(),
  name: faker.person.fullName(),
  email: faker.internet.email(),
  walletAddress: `0x${faker.finance.ethereumAddress()}`,
  ...overrides,
});

// Campaign Fixtures
export const createMockCampaign = (overrides: Partial<Campaign> = {}): Campaign => {
  const startDate = overrides.createdAt || createFixedDate(0);
  const endDate = overrides.endDate || createFixedDate(30);
  
  let status: CampaignStatus = 'draft';
  if (startDate < FIXED_NOW && endDate > FIXED_NOW) {
    status = 'active';
  } else if (endDate < FIXED_NOW) {
    status = 'expired';
  }

  return {
    id: uuidv4(),
    title: faker.lorem.sentence(),
    description: faker.lorem.paragraph(),
    goalAmount: faker.number.int({ min: 100, max: 10000 }),
    currentAmount: 0,
    status,
    createdAt: startDate,
    endDate,
    ownerId: uuidv4(),
    ...overrides,
  };
};

// Pledge Fixtures
export const createMockPledge = (overrides: Partial<Pledge> = {}): Pledge => ({
  id: uuidv4(),
  campaignId: uuidv4(),
  userId: uuidv4(),
  amount: faker.number.int({ min: 10, max: 500 }),
  status: 'confirmed',
  createdAt: createFixedDate(1),
  ...overrides,
});

// Helper to create a full lifecycle state
export const createCampaignState = (overrides: {
  user?: User;
  campaign?: Partial<Campaign>;
  pledges?: Partial<Pledge>[];
} = {}) => {
  const user = overrides.user || createMockUser();
  const campaign = createMockCampaign({
    ...overrides.campaign,
    ownerId: user.id,
  });
  
  const pledges = (overrides.pledges || []).map(p => 
    createMockPledge({
      ...p,
      campaignId: campaign.id,
      userId: p.userId || user.id,
    })
  );

  return {
    user,
    campaign,
    pledges,
  };
};