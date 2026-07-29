import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { Discover } from './Discover';
import * as api from '../services/api';

vi.mock('../services/api');

const mockCampaigns = [
  {
    id: '1',
    creator: 'GTEST1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ123456',
    title: 'Tech Innovation Project',
    description: 'A new technology project',
    acceptedTokens: ['USDC'],
    assetCode: 'USDC',
    targetAmount: 1000,
    pledgedAmount: 500,
    deadline: Date.now() / 1000 + 86400,
    createdAt: Date.now() / 1000 - 3600,
    progress: {
      status: 'open' as const,
      percentFunded: 50,
      remainingAmount: 500,
      pledgeCount: 5,
      hoursLeft: 24,
      canPledge: true,
      canClaim: false,
      canRefund: false,
    },
  },
  {
    id: '2',
    creator: 'GTEST9876543210ZYXWVUTSRQPONMLKJIHGFEDCBA987654',
    title: 'Art Gallery Exhibition',
    description: 'Support local artists',
    acceptedTokens: ['XLM'],
    assetCode: 'XLM',
    targetAmount: 2000,
    pledgedAmount: 1500,
    deadline: Date.now() / 1000 + 172800,
    createdAt: Date.now() / 1000 - 7200,
    progress: {
      status: 'open' as const,
      percentFunded: 75,
      remainingAmount: 500,
      pledgeCount: 10,
      hoursLeft: 48,
      canPledge: true,
      canClaim: false,
      canRefund: false,
    },
  },
];

describe('Discover Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the discover page with title and subtitle', async () => {
    vi.mocked(api.listCampaigns).mockResolvedValue({
      data: mockCampaigns,
      pagination: {
        total: 2,
        page: 1,
        limit: 100,
        totalPages: 1,
      },
    });

    render(
      <BrowserRouter>
        <Discover />
      </BrowserRouter>
    );

    expect(screen.getByText('Discover Campaigns')).toBeInTheDocument();
    expect(screen.getByText(/Explore innovative projects/i)).toBeInTheDocument();
  });

  it('renders category cards', async () => {
    vi.mocked(api.listCampaigns).mockResolvedValue({
      data: mockCampaigns,
      pagination: {
        total: 2,
        page: 1,
        limit: 100,
        totalPages: 1,
      },
    });

    render(
      <BrowserRouter>
        <Discover />
      </BrowserRouter>
    );

    expect(screen.getByText('Browse by Category')).toBeInTheDocument();
    expect(screen.getByText('Tech')).toBeInTheDocument();
    expect(screen.getByText('Art')).toBeInTheDocument();
    expect(screen.getByText('Community')).toBeInTheDocument();
    expect(screen.getByText('Education')).toBeInTheDocument();
    expect(screen.getByText('Environment')).toBeInTheDocument();
  });

  it('displays campaigns after loading', async () => {
    vi.mocked(api.listCampaigns).mockResolvedValue({
      data: mockCampaigns,
      pagination: {
        total: 2,
        page: 1,
        limit: 100,
        totalPages: 1,
      },
    });

    render(
      <BrowserRouter>
        <Discover />
      </BrowserRouter>
    );

    await waitFor(() => {
      const techProject = screen.getAllByText('Tech Innovation Project');
      const artGallery = screen.getAllByText('Art Gallery Exhibition');
      expect(techProject.length).toBeGreaterThan(0);
      expect(artGallery.length).toBeGreaterThan(0);
    });
  });

  it('shows loading state initially', () => {
    vi.mocked(api.listCampaigns).mockImplementation(
      () => new Promise(() => {}) // Never resolves
    );

    render(
      <BrowserRouter>
        <Discover />
      </BrowserRouter>
    );

    // Should show skeleton cards while loading
    const skeletonCards = document.querySelectorAll('.animate-pulse');
    expect(skeletonCards.length).toBeGreaterThan(0);
  });

  it('handles empty campaign list', async () => {
    vi.mocked(api.listCampaigns).mockResolvedValue({
      data: [],
      pagination: {
        total: 0,
        page: 1,
        limit: 100,
        totalPages: 0,
      },
    });

    render(
      <BrowserRouter>
        <Discover />
      </BrowserRouter>
    );

    await waitFor(() => {
      const emptyMessages = screen.getAllByText('No campaigns found');
      expect(emptyMessages.length).toBeGreaterThan(0);
    });
  });

  it('renders navigation back button', () => {
    vi.mocked(api.listCampaigns).mockResolvedValue({
      data: mockCampaigns,
      pagination: {
        total: 2,
        page: 1,
        limit: 100,
        totalPages: 1,
      },
    });

    render(
      <BrowserRouter>
        <Discover />
      </BrowserRouter>
    );

    expect(screen.getByText(/Back to Control Center/i)).toBeInTheDocument();
  });
});
