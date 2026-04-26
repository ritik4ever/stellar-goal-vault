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
