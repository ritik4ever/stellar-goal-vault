import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CreateCampaignForm } from './CreateCampaignForm';
import { ApiError } from '../types/campaign';

describe('CreateCampaignForm', () => {
  const validCreator = `G${'A'.repeat(55)}`;
  const validTitle = 'My Test Campaign';
  const validDescription = 'This campaign funds a real Soroban pledge flow for the MVP dashboard.';

  const fillBasics = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.type(screen.getByPlaceholderText(/G\.\.\. creator public key/i), validCreator);
    await user.type(screen.getByPlaceholderText(/Stellar community design sprint/i), validTitle);
    await user.type(
      screen.getByPlaceholderText(/Describe what the campaign funds/i),
      validDescription,
    );
    await user.selectOptions(screen.getByRole('combobox'), 'Community');
  };

  const clickNext = (user: ReturnType<typeof userEvent.setup>) =>
    user.click(screen.getByRole('button', { name: /^next$/i }));

  const clickBack = (user: ReturnType<typeof userEvent.setup>) =>
    user.click(screen.getByRole('button', { name: /^back$/i }));

  const advanceToFunding = async (user: ReturnType<typeof userEvent.setup>) => {
    await fillBasics(user);
    await clickNext(user);
  };

  const advanceToRewards = async (user: ReturnType<typeof userEvent.setup>) => {
    await advanceToFunding(user);
    await clickNext(user);
  };

  const advanceToReview = async (user: ReturnType<typeof userEvent.setup>) => {
    await advanceToRewards(user);
    await clickNext(user);
  };

  describe('Stepper', () => {
    it('renders all four steps', () => {
      render(<CreateCampaignForm onCreate={async () => {}} />);

      expect(screen.getByRole('button', { name: /basics/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /funding/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /rewards/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /review/i })).toBeInTheDocument();
    });

    it('starts on the Basics step with no Back button', () => {
      render(<CreateCampaignForm onCreate={async () => {}} />);

      expect(screen.getByPlaceholderText(/G\.\.\. creator public key/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^back$/i })).not.toBeInTheDocument();
    });

    it('does not allow jumping ahead to an unvisited step', async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={async () => {}} />);

      await user.click(screen.getByRole('button', { name: /funding/i }));

      expect(screen.getByPlaceholderText(/G\.\.\. creator public key/i)).toBeInTheDocument();
    });

    it('allows jumping back to a previously visited step and preserves data', async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={async () => {}} />);

      await advanceToFunding(user);
      await user.click(screen.getByRole('button', { name: /basics/i }));

      expect(screen.getByPlaceholderText(/G\.\.\. creator public key/i)).toHaveValue(validCreator);
      expect(screen.getByPlaceholderText(/Stellar community design sprint/i)).toHaveValue(
        validTitle,
      );
    });
  });

  describe('Step 1 - Basics', () => {
    it('blocks Next and shows errors when required fields are empty', async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={async () => {}} />);

      await clickNext(user);

      expect(screen.getByText('Creator account is required')).toBeInTheDocument();
      expect(screen.getByText('Campaign title is required')).toBeInTheDocument();
      expect(screen.getByText('Campaign description is required')).toBeInTheDocument();
      expect(screen.getByText('Category is required')).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/G\.\.\. creator public key/i)).toBeInTheDocument();
    });

    it('advances to Funding when all basics fields are valid', async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={async () => {}} />);

      await advanceToFunding(user);

      expect(screen.getByLabelText(/target amount/i)).toBeInTheDocument();
      expect(screen.queryByPlaceholderText(/G\.\.\. creator public key/i)).not.toBeInTheDocument();
    });
  });

  describe('Step 2 - Funding', () => {
    it('renders funding fields with sensible defaults', async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={async () => {}} />);

      await advanceToFunding(user);

      expect(screen.getByLabelText(/target amount/i)).toHaveValue(250);
      expect(screen.getByLabelText(/deadline in hours/i)).toHaveValue(72);
      expect(screen.getByLabelText(/max per contributor/i)).toHaveValue(null);
    });

    it('shows an error for an invalid max per contributor value', async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={async () => {}} />);

      await advanceToFunding(user);
      await user.type(screen.getByLabelText(/max per contributor/i), '0');
      await clickNext(user);

      expect(screen.getByText('Max per contributor must be greater than zero')).toBeInTheDocument();
      expect(screen.getByLabelText(/target amount/i)).toBeInTheDocument();
    });

    it('going back preserves funding data entered so far', async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={async () => {}} />);

      await advanceToFunding(user);
      await user.type(screen.getByLabelText(/max per contributor/i), '5');
      await clickBack(user);
      await clickNext(user);

      expect(screen.getByLabelText(/max per contributor/i)).toHaveValue(5);
    });

    it('advances to Rewards when funding fields are valid', async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={async () => {}} />);

      await advanceToRewards(user);

      expect(screen.getByRole('button', { name: /add reward tier/i })).toBeInTheDocument();
    });
  });

  describe('Step 3 - Rewards', () => {
    it('allows skipping reward tiers entirely', async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={async () => {}} />);

      await advanceToRewards(user);
      await clickNext(user);

      expect(screen.getByRole('button', { name: /create campaign/i })).toBeInTheDocument();
    });

    it('requires tier fields once a tier is added', async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={async () => {}} />);

      await advanceToRewards(user);
      await user.click(screen.getByRole('button', { name: /add reward tier/i }));
      await clickNext(user);

      expect(screen.getByText('Reward title is required')).toBeInTheDocument();
      expect(screen.getByText('Minimum pledge amount is required')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /create campaign/i })).not.toBeInTheDocument();
    });

    it('advances once tier fields are valid', async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={async () => {}} />);

      await advanceToRewards(user);
      await user.click(screen.getByRole('button', { name: /add reward tier/i }));
      await user.type(screen.getByPlaceholderText(/early supporter badge/i), 'Gold Tier');
      await user.type(screen.getByLabelText(/minimum pledge amount/i), '50');
      await clickNext(user);

      expect(screen.getByRole('button', { name: /create campaign/i })).toBeInTheDocument();
    });

    it('removes a reward tier', async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={async () => {}} />);

      await advanceToRewards(user);
      await user.click(screen.getByRole('button', { name: /add reward tier/i }));
      expect(screen.getByPlaceholderText(/early supporter badge/i)).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /remove/i }));
      expect(screen.queryByPlaceholderText(/early supporter badge/i)).not.toBeInTheDocument();
    });
  });

  describe('Step 4 - Review', () => {
    it('shows a full preview of entered data before submission', async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={async () => {}} />);

      await advanceToReview(user);

      expect(screen.getByText(validTitle)).toBeInTheDocument();
      expect(screen.getByText(validDescription)).toBeInTheDocument();
      expect(screen.getByText('Community')).toBeInTheDocument();
      expect(screen.getByText(validCreator)).toBeInTheDocument();
      expect(screen.getByText('USDC')).toBeInTheDocument();
    });

    it('going back from review preserves rewards step state', async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={async () => {}} />);

      await advanceToReview(user);
      await clickBack(user);

      expect(screen.getByRole('button', { name: /add reward tier/i })).toBeInTheDocument();
    });
  });

  describe('Submission', () => {
    it('calls onCreate with the full payload after completing all steps', async () => {
      const user = userEvent.setup();
      const onCreate = vi.fn().mockResolvedValue(undefined);
      const mockDate = new Date('2024-01-01T12:00:00Z');
      vi.setSystemTime(mockDate);

      render(<CreateCampaignForm onCreate={onCreate} />);

      await advanceToFunding(user);
      await user.type(screen.getByLabelText(/max per contributor/i), '5');
      await clickNext(user);
      await clickNext(user);

      await user.click(screen.getByRole('button', { name: /create campaign/i }));

      await waitFor(() => {
        expect(onCreate).toHaveBeenCalledTimes(1);
      });

      const expectedDeadline = Math.floor(mockDate.getTime() / 1000) + 72 * 3600;
      expect(onCreate).toHaveBeenCalledWith({
        creator: validCreator,
        title: validTitle,
        description: validDescription,
        acceptedTokens: ['USDC'],
        targetAmount: 250,
        deadline: expectedDeadline,
        metadata: {},
        maxPerContributor: 5,
      });

      vi.useRealTimers();
    });

    it('resets to the first step after successful submission', async () => {
      const user = userEvent.setup();
      const onCreate = vi.fn().mockResolvedValue(undefined);

      render(<CreateCampaignForm onCreate={onCreate} />);

      await advanceToReview(user);
      await user.click(screen.getByRole('button', { name: /create campaign/i }));

      await waitFor(() => {
        expect(onCreate).toHaveBeenCalledTimes(1);
      });

      expect(screen.getByPlaceholderText(/G\.\.\. creator public key/i)).toHaveValue('');
      expect(screen.queryByRole('button', { name: /^back$/i })).not.toBeInTheDocument();
    });

    it('disables submit button and shows progress while submitting', async () => {
      const user = userEvent.setup();
      let resolveCreate: () => void;
      const onCreate = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveCreate = resolve;
          }),
      );

      render(<CreateCampaignForm onCreate={onCreate} />);

      await advanceToReview(user);
      const submitButton = screen.getByRole('button', { name: /create campaign/i });
      await user.click(submitButton);

      expect(submitButton).toBeDisabled();
      expect(submitButton).toHaveTextContent('Creating...');

      resolveCreate!();
      await waitFor(() => {
        expect(submitButton).not.toBeDisabled();
      });
    });

    it('re-validates every step on submit and jumps to the first invalid one', async () => {
      const user = userEvent.setup();
      const onCreate = vi.fn().mockResolvedValue(undefined);

      render(<CreateCampaignForm onCreate={onCreate} />);

      await advanceToReview(user);
      await user.click(screen.getByRole('button', { name: /basics/i }));
      await user.clear(screen.getByPlaceholderText(/Stellar community design sprint/i));
      await user.click(screen.getByRole('button', { name: /review/i }));
      await user.click(screen.getByRole('button', { name: /create campaign/i }));

      expect(onCreate).not.toHaveBeenCalled();
      expect(screen.getByText('Campaign title is required')).toBeInTheDocument();
    });
  });

  describe('API Error Handling', () => {
    it('displays API error message on the review step', async () => {
      const user = userEvent.setup();
      const apiError: ApiError = {
        message: 'Something went wrong',
      };

      render(<CreateCampaignForm onCreate={async () => {}} apiError={apiError} />);
      await advanceToReview(user);

      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    });

    it('displays API error with details', async () => {
      const user = userEvent.setup();
      const apiError: ApiError = {
        message: 'Validation failed',
        details: [
          { field: 'creator', message: 'Invalid account' },
          { field: 'title', message: 'Title already exists' },
        ],
      };

      render(<CreateCampaignForm onCreate={async () => {}} apiError={apiError} />);
      await advanceToReview(user);

      expect(screen.getByText('Validation failed')).toBeInTheDocument();
      expect(screen.getByText(/creator:/i)).toBeInTheDocument();
      expect(screen.getByText(/Invalid account/i)).toBeInTheDocument();
      expect(screen.getByText(/title:/i)).toBeInTheDocument();
      expect(screen.getByText(/Title already exists/i)).toBeInTheDocument();
    });

    it('displays API error with code and request ID', async () => {
      const user = userEvent.setup();
      const apiError: ApiError = {
        message: 'Server error',
        code: 'ERR_500',
        requestId: 'req-123',
      };

      render(<CreateCampaignForm onCreate={async () => {}} apiError={apiError} />);
      await advanceToReview(user);

      expect(screen.getByText('Server error')).toBeInTheDocument();
      expect(screen.getByText(/Code: ERR_500/i)).toBeInTheDocument();
      expect(screen.getByText(/Request ID: req-123/i)).toBeInTheDocument();
    });

    it('does not display error section when apiError is null', async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={async () => {}} apiError={null} />);
      await advanceToReview(user);

      expect(screen.queryByText(/Code:/i)).not.toBeInTheDocument();
    });
  });
});
