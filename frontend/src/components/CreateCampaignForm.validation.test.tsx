import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CreateCampaignForm } from './CreateCampaignForm';
import { vi } from 'vitest';

describe('CreateCampaignForm Validation', () => {
  const mockOnCreate = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Step 1 field errors', () => {
    it('displays creator account error for invalid Stellar address', async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={mockOnCreate} allowedAssets={['USDC']} />);

      const creatorInput = screen.getByPlaceholderText(/G\.\.\. creator public key/i);
      await user.type(creatorInput, 'invalid');
      fireEvent.blur(creatorInput);

      expect(
        screen.getByText(/Stellar account must be exactly 56 characters/i),
      ).toBeInTheDocument();
    });

    it('displays title error for too short title', async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={mockOnCreate} allowedAssets={['USDC']} />);

      const titleInput = screen.getByPlaceholderText(/Stellar community design sprint/i);
      await user.type(titleInput, 'Bad');
      fireEvent.blur(titleInput);

      expect(screen.getByText(/at least 4 characters/i)).toBeInTheDocument();
    });

    it('displays description error for too short description', async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={mockOnCreate} allowedAssets={['USDC']} />);

      const descInput = screen.getByPlaceholderText(/Describe what the campaign funds/i);
      await user.type(descInput, 'Short');
      fireEvent.blur(descInput);

      expect(screen.getByText(/at least 20 characters/i)).toBeInTheDocument();
    });

    it('displays category error when left unselected', async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={mockOnCreate} allowedAssets={['USDC']} />);

      const categorySelect = screen.getByRole('combobox');
      await user.click(categorySelect);
      fireEvent.blur(categorySelect);

      expect(screen.getByText('Category is required')).toBeInTheDocument();
    });

    it('applies input-error class to fields with validation errors', async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={mockOnCreate} allowedAssets={['USDC']} />);

      const creatorInput = screen.getByPlaceholderText(
        /G\.\.\. creator public key/i,
      ) as HTMLInputElement;
      await user.type(creatorInput, 'invalid');
      fireEvent.blur(creatorInput);

      expect(creatorInput).toHaveClass('input-error');
    });

    it('removes input-error class when field becomes valid', async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={mockOnCreate} allowedAssets={['USDC']} />);

      const creatorInput = screen.getByPlaceholderText(
        /G\.\.\. creator public key/i,
      ) as HTMLInputElement;

      await user.type(creatorInput, 'invalid');
      fireEvent.blur(creatorInput);
      expect(creatorInput).toHaveClass('input-error');

      await user.clear(creatorInput);
      await user.type(creatorInput, 'G' + 'A'.repeat(55));

      expect(creatorInput).not.toHaveClass('input-error');
      expect(screen.queryByText(/Invalid Stellar account format/i)).not.toBeInTheDocument();
    });

    it('validates on field change, not just on step submit', async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={mockOnCreate} allowedAssets={['USDC']} />);

      const titleInput = screen.getByPlaceholderText(/Stellar community design sprint/i);

      await user.type(titleInput, 'Bad');
      fireEvent.blur(titleInput);
      expect(screen.getByText(/at least 4 characters/i)).toBeInTheDocument();

      await user.type(titleInput, 's');
      expect(screen.queryByText(/at least 4 characters/i)).not.toBeInTheDocument();
    });

    it('blocks advancing to Funding while Step 1 is invalid', async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={mockOnCreate} allowedAssets={['USDC']} />);

      const creatorInput = screen.getByPlaceholderText(/G\.\.\. creator public key/i);
      await user.type(creatorInput, 'invalid');
      await user.click(screen.getByRole('button', { name: /^next$/i }));

      expect(mockOnCreate).not.toHaveBeenCalled();
      expect(screen.getByPlaceholderText(/G\.\.\. creator public key/i)).toBeInTheDocument();
    });
  });

  describe('Step 2 field errors', () => {
    async function goToFunding(user: ReturnType<typeof userEvent.setup>) {
      await user.type(
        screen.getByPlaceholderText(/G\.\.\. creator public key/i),
        'G' + 'A'.repeat(55),
      );
      await user.type(
        screen.getByPlaceholderText(/Stellar community design sprint/i),
        'My Valid Campaign Title',
      );
      await user.type(
        screen.getByPlaceholderText(/Describe what the campaign funds/i),
        'This is a valid campaign description with enough content.',
      );
      await user.selectOptions(screen.getByRole('combobox'), 'Community');
      await user.click(screen.getByRole('button', { name: /^next$/i }));
    }

    it('displays amount error for negative or zero amount', async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={mockOnCreate} allowedAssets={['USDC']} />);
      await goToFunding(user);

      const amountInput = screen.getByLabelText(/target amount/i);
      await user.clear(amountInput);
      await user.type(amountInput, '0');
      fireEvent.blur(amountInput);

      expect(screen.getByText(/Amount must be greater than zero/i)).toBeInTheDocument();
    });

    it('displays deadline error for zero hours', async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={mockOnCreate} allowedAssets={['USDC']} />);
      await goToFunding(user);

      const deadlineInput = screen.getByLabelText(/deadline in hours/i);
      await user.clear(deadlineInput);
      await user.type(deadlineInput, '0');
      fireEvent.blur(deadlineInput);

      expect(screen.getByText(/at least 0.0001 hours/i)).toBeInTheDocument();
    });

    it('displays an error when max per contributor is not a whole number', async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={mockOnCreate} allowedAssets={['USDC']} />);
      await goToFunding(user);

      const maxPerContributorInput = screen.getByLabelText(/max per contributor/i);
      await user.type(maxPerContributorInput, '1.5');
      fireEvent.blur(maxPerContributorInput);

      expect(screen.getByText('Max per contributor must be a whole number')).toBeInTheDocument();
    });

    it('treats an empty max per contributor as valid (no cap)', async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={mockOnCreate} allowedAssets={['USDC']} />);
      await goToFunding(user);

      const maxPerContributorInput = screen.getByLabelText(/max per contributor/i);
      fireEvent.blur(maxPerContributorInput);

      expect(
        screen.queryByText(/Max per contributor must be/i),
      ).not.toBeInTheDocument();
    });
  });
});
