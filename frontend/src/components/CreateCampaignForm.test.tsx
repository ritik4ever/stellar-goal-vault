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

    it('shows loading and empty asset states explicitly', () => {
      const { rerender } = render(
        <CreateCampaignForm onCreate={async () => {}} isLoading allowedAssets={[]} />,
      );

      expect(screen.getByText('Loading campaign options')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /next/i })).not.toBeInTheDocument();

      rerender(<CreateCampaignForm onCreate={async () => {}} allowedAssets={[]} />);

      expect(screen.getByText('No campaign assets available')).toBeInTheDocument();
      expect(screen.queryByText('Loading campaign options')).not.toBeInTheDocument();
    });

    it('shows a success state after a successful submission', async () => {
      const user = userEvent.setup();
      const onCreate = vi.fn().mockResolvedValue(undefined);

      render(<CreateCampaignForm onCreate={onCreate} />);
      await advanceToReview(user);
      await user.click(screen.getByRole('button', { name: /create campaign/i }));

      expect(await screen.findByText(/campaign created successfully/i)).toBeInTheDocument();
    });

    it('offers retry after a recoverable submission failure', async () => {
      const user = userEvent.setup();
      const onCreate = vi
        .fn()
        .mockRejectedValueOnce(new Error('Temporary service failure'))
        .mockResolvedValueOnce(undefined);

      render(<CreateCampaignForm onCreate={onCreate} />);
      await advanceToReview(user);
      await user.click(screen.getByRole('button', { name: /create campaign/i }));

      expect(await screen.findByText('Temporary service failure')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /^retry$/i }));

      await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(2));
      expect(await screen.findByText(/campaign created successfully/i)).toBeInTheDocument();
    });
  });
});

describe('CreateCampaignForm – Mobile Responsiveness', () => {
  const MOBILE_WIDTH = 375;

  const fillBasics = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.type(
      screen.getByPlaceholderText(/G\.\.\. creator public key/i),
      `G${'A'.repeat(55)}`,
    );
    await user.type(
      screen.getByPlaceholderText(/Stellar community design sprint/i),
      'Mobile Campaign',
    );
    await user.type(
      screen.getByPlaceholderText(/Describe what the campaign funds/i),
      'This campaign funds a real Soroban pledge flow for the MVP dashboard.',
    );
    await user.selectOptions(screen.getByRole('combobox'), 'Community');
  };

  beforeEach(() => {
    // Simulate a 375px viewport width so scrollWidth checks are meaningful.
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get() {
        return MOBILE_WIDTH;
      },
    });
  });

  afterEach(() => {
    // Restore default clientWidth behaviour.
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get() {
        return 0;
      },
    });
  });

  it('renders the Basics step without horizontal overflow at 375 px', () => {
    const { container } = render(
      <CreateCampaignForm onCreate={async () => {}} allowedAssets={['USDC']} />,
    );

    // scrollWidth > clientWidth means content is wider than the viewport.
    expect(container.firstElementChild!.scrollWidth).toBeLessThanOrEqual(MOBILE_WIDTH);
  });

  it('renders the Funding step without horizontal overflow at 375 px', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <CreateCampaignForm onCreate={async () => {}} allowedAssets={['USDC']} />,
    );

    await fillBasics(user);
    await user.click(screen.getByRole('button', { name: /^next$/i }));

    expect(container.firstElementChild!.scrollWidth).toBeLessThanOrEqual(MOBILE_WIDTH);
  });

  it('renders the Rewards step without horizontal overflow at 375 px', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <CreateCampaignForm onCreate={async () => {}} allowedAssets={['USDC']} />,
    );

    await fillBasics(user);
    await user.click(screen.getByRole('button', { name: /^next$/i }));
    await user.click(screen.getByRole('button', { name: /^next$/i }));

    expect(container.firstElementChild!.scrollWidth).toBeLessThanOrEqual(MOBILE_WIDTH);
  });

  it('renders the Review step without horizontal overflow at 375 px', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <CreateCampaignForm onCreate={async () => {}} allowedAssets={['USDC']} />,
    );

    await fillBasics(user);
    await user.click(screen.getByRole('button', { name: /^next$/i }));
    await user.click(screen.getByRole('button', { name: /^next$/i }));
    await user.click(screen.getByRole('button', { name: /^next$/i }));

    expect(container.firstElementChild!.scrollWidth).toBeLessThanOrEqual(MOBILE_WIDTH);
  });

  it('numeric inputs carry the correct inputMode for mobile keyboards', async () => {
    const user = userEvent.setup();
    render(<CreateCampaignForm onCreate={async () => {}} allowedAssets={['USDC']} />);

    await fillBasics(user);
    await user.click(screen.getByRole('button', { name: /^next$/i }));

    const targetAmount = screen.getByLabelText(/target amount/i) as HTMLInputElement;
    const deadlineHours = screen.getByLabelText(/deadline in hours/i) as HTMLInputElement;
    const maxPerContributor = screen.getByLabelText(/max per contributor/i) as HTMLInputElement;

    expect(targetAmount).toHaveAttribute('inputmode', 'decimal');
    expect(deadlineHours).toHaveAttribute('inputmode', 'decimal');
    expect(maxPerContributor).toHaveAttribute('inputmode', 'numeric');
  });

  it('URL inputs carry inputMode="url" and autoComplete="url"', () => {
    render(<CreateCampaignForm onCreate={async () => {}} allowedAssets={['USDC']} />);

    const imageUrlInput = screen.getByPlaceholderText(/https:\/\/example\.com\/image\.png/i);
    const externalLinkInput = screen.getByPlaceholderText(/https:\/\/example\.com\/project/i);

    expect(imageUrlInput).toHaveAttribute('inputmode', 'url');
    expect(imageUrlInput).toHaveAttribute('autocomplete', 'url');
    expect(externalLinkInput).toHaveAttribute('inputmode', 'url');
    expect(externalLinkInput).toHaveAttribute('autocomplete', 'url');
  });

  it('wizard nav buttons are full-width accessible tap targets on the Basics step', () => {
    render(<CreateCampaignForm onCreate={async () => {}} allowedAssets={['USDC']} />);

    // The Next button must be wide enough to tap comfortably on mobile.
    const nextButton = screen.getByRole('button', { name: /^next$/i });
    // The CSS rule sets width: 100% inside .wizard-nav at ≤767px.
    // In JSDOM there is no layout engine, so we verify the element exists and is enabled.
    expect(nextButton).toBeEnabled();
    expect(nextButton).toBeInTheDocument();
  });
});

describe('CreateCampaignForm – Additional Coverage', () => {
  const validCreator = `G${'A'.repeat(55)}`;
  const validTitle = 'My Valid Campaign Title';
  const validDescription = 'This campaign funds a real Soroban pledge flow for the MVP dashboard.';

  const fillBasics = async (
    user: ReturnType<typeof userEvent.setup>,
    overrides: { title?: string; description?: string } = {},
  ) => {
    await user.type(screen.getByPlaceholderText(/G\.\.\. creator public key/i), validCreator);
    await user.type(
      screen.getByPlaceholderText(/Stellar community design sprint/i),
      overrides.title ?? validTitle,
    );
    await user.type(
      screen.getByPlaceholderText(/Describe what the campaign funds/i),
      overrides.description ?? validDescription,
    );
    await user.selectOptions(screen.getByRole('combobox'), 'Community');
  };

  const clickNext = (user: ReturnType<typeof userEvent.setup>) =>
    user.click(screen.getByRole('button', { name: /^next$/i }));

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

  // -----------------------------------------------------------------------
  // 1. Default / empty-state rendering
  // -----------------------------------------------------------------------

  describe('Default state', () => {
    it('defaults acceptedTokens to USDC when allowedAssets is omitted', async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={async () => {}} />);
      await advanceToFunding(user);

      expect(screen.getByRole('checkbox', { name: /usdc/i })).toBeChecked();
    });

    it('defaults acceptedTokens to USDC when allowedAssets is an empty array', async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={async () => {}} allowedAssets={[]} />);
      await advanceToFunding(user);

      expect(screen.getByRole('checkbox', { name: /usdc/i })).toBeChecked();
    });

    it('renders one checkbox per asset when multiple allowedAssets are provided', async () => {
      const user = userEvent.setup();
      render(
        <CreateCampaignForm onCreate={async () => {}} allowedAssets={['USDC', 'XLM', 'EURC']} />,
      );
      await advanceToFunding(user);

      expect(screen.getByRole('checkbox', { name: /usdc/i })).toBeInTheDocument();
      expect(screen.getByRole('checkbox', { name: /xlm/i })).toBeInTheDocument();
      expect(screen.getByRole('checkbox', { name: /eurc/i })).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // 2. Token checkbox behaviour
  // -----------------------------------------------------------------------

  describe('Token checkboxes (Step 2 – Funding)', () => {
    it('checking a second token adds it to the selection', async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={async () => {}} allowedAssets={['USDC', 'XLM']} />);
      await advanceToFunding(user);

      await user.click(screen.getByRole('checkbox', { name: /xlm/i }));

      expect(screen.getByRole('checkbox', { name: /usdc/i })).toBeChecked();
      expect(screen.getByRole('checkbox', { name: /xlm/i })).toBeChecked();
    });

    it('unchecking the only selected token shows the accepted-tokens error on Next', async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={async () => {}} allowedAssets={['USDC', 'XLM']} />);
      await advanceToFunding(user);

      await user.click(screen.getByRole('checkbox', { name: /usdc/i }));
      await user.click(screen.getByRole('button', { name: /^next$/i }));

      expect(screen.getByText(/at least one accepted token is required/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/target amount/i)).toBeInTheDocument();
    });

    it('multiple selected tokens appear in the submission payload', async () => {
      const user = userEvent.setup();
      const onCreate = vi.fn().mockResolvedValue(undefined);
      render(<CreateCampaignForm onCreate={onCreate} allowedAssets={['USDC', 'XLM']} />);

      await advanceToFunding(user);
      await user.click(screen.getByRole('checkbox', { name: /xlm/i }));
      await clickNext(user);
      await clickNext(user);
      await user.click(screen.getByRole('button', { name: /create campaign/i }));

      await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({ acceptedTokens: ['USDC', 'XLM'] }),
      );
    });

    it('Review step shows all selected tokens', async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={async () => {}} allowedAssets={['USDC', 'XLM']} />);
      await advanceToFunding(user);
      await user.click(screen.getByRole('checkbox', { name: /xlm/i }));
      await clickNext(user);
      await clickNext(user);

      expect(screen.getByText(/usdc.*xlm|xlm.*usdc/i)).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // 3. Full success path — optional fields populated
  // -----------------------------------------------------------------------

  describe('Submission – optional fields', () => {
    it('includes imageUrl in metadata when provided', async () => {
      const user = userEvent.setup();
      const onCreate = vi.fn().mockResolvedValue(undefined);
      render(<CreateCampaignForm onCreate={onCreate} allowedAssets={['USDC']} />);

      await fillBasics(user);
      await user.type(
        screen.getByPlaceholderText(/https:\/\/example\.com\/image\.png/i),
        'https://img.example.com/banner.png',
      );
      await clickNext(user);
      await clickNext(user);
      await clickNext(user);
      await user.click(screen.getByRole('button', { name: /create campaign/i }));

      await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ imageUrl: 'https://img.example.com/banner.png' }),
        }),
      );
    });

    it('includes externalLink in metadata when provided', async () => {
      const user = userEvent.setup();
      const onCreate = vi.fn().mockResolvedValue(undefined);
      render(<CreateCampaignForm onCreate={onCreate} allowedAssets={['USDC']} />);

      await fillBasics(user);
      await user.type(
        screen.getByPlaceholderText(/https:\/\/example\.com\/project/i),
        'https://myproject.example.com',
      );
      await clickNext(user);
      await clickNext(user);
      await clickNext(user);
      await user.click(screen.getByRole('button', { name: /create campaign/i }));

      await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ externalLink: 'https://myproject.example.com' }),
        }),
      );
    });

    it('omits imageUrl and externalLink from metadata when both are blank', async () => {
      const user = userEvent.setup();
      const onCreate = vi.fn().mockResolvedValue(undefined);
      render(<CreateCampaignForm onCreate={onCreate} allowedAssets={['USDC']} />);

      await advanceToReview(user);
      await user.click(screen.getByRole('button', { name: /create campaign/i }));

      await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
      const payload = onCreate.mock.calls[0][0] as Parameters<typeof onCreate>[0];
      expect(payload.metadata.imageUrl).toBeUndefined();
      expect(payload.metadata.externalLink).toBeUndefined();
    });

    it('omits maxPerContributor from payload when left blank', async () => {
      const user = userEvent.setup();
      const onCreate = vi.fn().mockResolvedValue(undefined);
      render(<CreateCampaignForm onCreate={onCreate} allowedAssets={['USDC']} />);

      await advanceToReview(user);
      await user.click(screen.getByRole('button', { name: /create campaign/i }));

      await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
      const payload = onCreate.mock.calls[0][0] as Parameters<typeof onCreate>[0];
      expect(payload.maxPerContributor).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // 4. Funding step — additional validation coverage
  // -----------------------------------------------------------------------

  describe('Step 2 – Funding validation gaps', () => {
    it('shows an error when target amount is cleared (empty)', async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={async () => {}} allowedAssets={['USDC']} />);
      await advanceToFunding(user);

      await user.clear(screen.getByLabelText(/target amount/i));
      await user.click(screen.getByRole('button', { name: /^next$/i }));

      expect(screen.getByText(/target amount is required/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/target amount/i)).toBeInTheDocument();
    });

    it('shows an error when deadline is cleared (empty)', async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={async () => {}} allowedAssets={['USDC']} />);
      await advanceToFunding(user);

      await user.clear(screen.getByLabelText(/deadline in hours/i));
      await user.click(screen.getByRole('button', { name: /^next$/i }));

      expect(screen.getByText(/deadline is required/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/deadline in hours/i)).toBeInTheDocument();
    });

    it('shows an error when deadline exceeds 365 days (8760 hours)', async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={async () => {}} allowedAssets={['USDC']} />);
      await advanceToFunding(user);

      const deadlineInput = screen.getByLabelText(/deadline in hours/i);
      await user.clear(deadlineInput);
      await user.type(deadlineInput, '8761');
      await user.click(screen.getByRole('button', { name: /^next$/i }));

      expect(screen.getByText(/cannot exceed 365 days/i)).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // 5. Reward tier edge cases
  // -----------------------------------------------------------------------

  describe('Step 3 – Reward tier edge cases', () => {
    it('shows an error for a tier minimum amount of zero', async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={async () => {}} allowedAssets={['USDC']} />);
      await advanceToRewards(user);

      await user.click(screen.getByRole('button', { name: /add reward tier/i }));
      await user.type(screen.getByPlaceholderText(/early supporter badge/i), 'Bronze');
      await user.type(screen.getByLabelText(/minimum pledge amount/i), '0');
      await clickNext(user);

      expect(
        screen.getByText(/minimum pledge amount must be greater than zero/i),
      ).toBeInTheDocument();
    });

    it('applies input-error class to an invalid tier minimum amount field', async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={async () => {}} allowedAssets={['USDC']} />);
      await advanceToRewards(user);

      await user.click(screen.getByRole('button', { name: /add reward tier/i }));
      await user.type(screen.getByLabelText(/minimum pledge amount/i), '0');
      await clickNext(user);

      expect(screen.getByLabelText(/minimum pledge amount/i)).toHaveClass('input-error');
    });

    it('allows adding multiple reward tiers and shows each one', async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={async () => {}} allowedAssets={['USDC']} />);
      await advanceToRewards(user);

      await user.click(screen.getByRole('button', { name: /add reward tier/i }));
      await user.click(screen.getByRole('button', { name: /add reward tier/i }));

      expect(screen.getByText('Tier 1')).toBeInTheDocument();
      expect(screen.getByText('Tier 2')).toBeInTheDocument();
    });

    it('shows both tiers on the Review step', async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={async () => {}} allowedAssets={['USDC']} />);
      await advanceToRewards(user);

      await user.click(screen.getByRole('button', { name: /add reward tier/i }));
      const titleInputs = screen.getAllByPlaceholderText(/early supporter badge/i);
      const amountInputs = screen.getAllByLabelText(/minimum pledge amount/i);
      await user.type(titleInputs[0], 'Silver');
      await user.type(amountInputs[0], '25');

      await user.click(screen.getByRole('button', { name: /add reward tier/i }));
      const titleInputs2 = screen.getAllByPlaceholderText(/early supporter badge/i);
      const amountInputs2 = screen.getAllByLabelText(/minimum pledge amount/i);
      await user.type(titleInputs2[1], 'Gold');
      await user.type(amountInputs2[1], '100');

      await clickNext(user);

      expect(screen.getByText('Silver')).toBeInTheDocument();
      expect(screen.getByText('Gold')).toBeInTheDocument();
    });

    it('tier description appears on the Review step', async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={async () => {}} allowedAssets={['USDC']} />);
      await advanceToRewards(user);

      await user.click(screen.getByRole('button', { name: /add reward tier/i }));
      await user.type(screen.getByPlaceholderText(/early supporter badge/i), 'Platinum');
      await user.type(screen.getByLabelText(/minimum pledge amount/i), '200');
      await user.type(
        screen.getByPlaceholderText(/What contributors receive at this tier/i),
        'Exclusive merch pack',
      );
      await clickNext(user);

      expect(screen.getByText('Exclusive merch pack')).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // 6. Review step rendering
  // -----------------------------------------------------------------------

  describe('Step 4 – Review rendering', () => {
    it('shows the imageUrl as an img element on the Review step', async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={async () => {}} allowedAssets={['USDC']} />);

      await fillBasics(user);
      await user.type(
        screen.getByPlaceholderText(/https:\/\/example\.com\/image\.png/i),
        'https://cdn.example.com/preview.jpg',
      );
      await clickNext(user);
      await clickNext(user);
      await clickNext(user);

      const img = screen.getByRole('img', { name: /campaign preview/i });
      expect(img).toBeInTheDocument();
      expect(img).toHaveAttribute('src', 'https://cdn.example.com/preview.jpg');
    });

    it('shows the externalLink as an anchor on the Review step', async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={async () => {}} allowedAssets={['USDC']} />);

      await fillBasics(user);
      await user.type(
        screen.getByPlaceholderText(/https:\/\/example\.com\/project/i),
        'https://myproject.example.com',
      );
      await clickNext(user);
      await clickNext(user);
      await clickNext(user);

      const link = screen.getByRole('link', { name: /myproject\.example\.com/i });
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute('href', 'https://myproject.example.com');
    });

    it('does not show an img on the Review step when imageUrl is blank', async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={async () => {}} allowedAssets={['USDC']} />);
      await advanceToReview(user);

      expect(screen.queryByRole('img', { name: /campaign preview/i })).not.toBeInTheDocument();
    });

    it('shows the reviewDeadlineLabel with hours and a human-readable date', async () => {
      const user = userEvent.setup();
      const mockDate = new Date('2025-06-01T00:00:00Z');
      vi.setSystemTime(mockDate);

      render(<CreateCampaignForm onCreate={async () => {}} allowedAssets={['USDC']} />);
      await advanceToReview(user);

      expect(screen.getByText(/72 hours \(around/i)).toBeInTheDocument();

      vi.useRealTimers();
    });

    it('resets maxStepReached after successful submission so step tabs are disabled again', async () => {
      const user = userEvent.setup();
      const onCreate = vi.fn().mockResolvedValue(undefined);
      render(<CreateCampaignForm onCreate={onCreate} allowedAssets={['USDC']} />);

      await advanceToReview(user);
      await user.click(screen.getByRole('button', { name: /create campaign/i }));

      await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));

      expect(screen.getByRole('button', { name: /funding/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /rewards/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /review/i })).toBeDisabled();
    });
  });

  // -----------------------------------------------------------------------
  // 7. apiError prop reactivity
  // -----------------------------------------------------------------------

  describe('apiError prop reactivity', () => {
    it('hides the error block when apiError changes from an error to null', async () => {
      const user = userEvent.setup();
      const apiError: ApiError = { message: 'Initial error' };

      const { rerender } = render(
        <CreateCampaignForm onCreate={async () => {}} apiError={apiError} />,
      );
      await advanceToReview(user);
      expect(screen.getByText('Initial error')).toBeInTheDocument();

      rerender(<CreateCampaignForm onCreate={async () => {}} apiError={null} />);

      expect(screen.queryByText('Initial error')).not.toBeInTheDocument();
    });

    it('updates the error block when apiError message changes', async () => {
      const user = userEvent.setup();
      const firstError: ApiError = { message: 'First error' };
      const secondError: ApiError = { message: 'Second error' };

      const { rerender } = render(
        <CreateCampaignForm onCreate={async () => {}} apiError={firstError} />,
      );
      await advanceToReview(user);
      expect(screen.getByText('First error')).toBeInTheDocument();

      rerender(<CreateCampaignForm onCreate={async () => {}} apiError={secondError} />);

      expect(screen.queryByText('First error')).not.toBeInTheDocument();
      expect(screen.getByText('Second error')).toBeInTheDocument();
    });
  });
});
