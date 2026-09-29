# Frontend Testing Guide

## Setup

Dependencies are already installed. No extra steps needed.

## Running Tests

```bash
cd frontend
npm test
```

## Test Files

- `src/components/CreateCampaignForm.test.tsx` — tests for campaign creation flow
- `src/components/CampaignDetailPanel.test.tsx` — tests for pledge, claim, and refund flows

## What Is Covered

- All form fields render correctly
- API errors display properly
- Success messages display properly
- Form resets after submission
- Pledge submission calls the correct handler
- Empty state renders when no campaign is selected

## Notes

- Tests use Vitest + React Testing Library
- jsdom is used as the browser environment
- `ECONNREFUSED` warnings during tests are expected — the backend is not running during testing and do not affect results

## Focused pledge form coverage

Run the pledge component suites with:

```sh
npx vitest run src/components/CampaignDetailPanel.pledge.test.tsx src/components/CampaignDetailPanel.test.tsx src/components/TransactionPreviewModal.pledge.test.tsx
```

`CampaignDetailPanel.pledge.test.tsx` renders the real form and mocks only the
unrelated contributor polling component. It passes an `onPledge` spy at the
component boundary and uses user events (not direct form submission) so native
required/minimum/step validation actually runs.

Coverage includes the submitted campaign ID, numeric amount and chosen token;
amount/token reset after success; disabled inputs and duplicate prevention
while a controlled promise is pending; external reconciliation state; empty and
loading states; wallet/campaign restrictions; rejected pledges, fee-estimation
errors, and retries that preserve the entered values. No wallet extension,
backend server, or live transaction is needed for these component tests.

These tests do not replace backend campaign/accounting tests or on-chain tests.
