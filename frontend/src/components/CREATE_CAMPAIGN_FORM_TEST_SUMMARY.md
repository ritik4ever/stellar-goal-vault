# CreateCampaignForm Test Coverage Summary

## Overview
`CreateCampaignForm` is a four-step campaign creation wizard (Basics → Funding → Rewards → Review). Test coverage spans wizard navigation, per-step validation, and submission behavior across three files.

## Test Files

### 1. CreateCampaignForm.test.tsx (Main Test Suite)
- **Stepper**: renders all four steps, blocks jumping to unvisited steps, allows jumping back to visited steps, preserves entered data across navigation.
- **Step 1 - Basics**: creator, title, description, category fields; blocks advancing until valid.
- **Step 2 - Funding**: accepted tokens, target amount, deadline, optional max per contributor; blocks advancing until valid; back preserves entered values.
- **Step 3 - Rewards**: optional reward tiers can be skipped entirely; once a tier is added its fields become required; tiers can be removed.
- **Step 4 - Review**: shows a full preview of every entered field before submission; back preserves state.
- **Submission**: full payload sent to `onCreate` (including `maxPerContributor`), submit button disabled while pending, wizard resets to step 1 on success, and submitting re-validates every step and jumps to the first invalid one.
- **API Error Handling**: error message, details, and code/request ID rendered on the Review step.

### 2. CreateCampaignForm.validation.test.tsx (Validation-Focused Tests)
- Field-level error display and `input-error` styling for Step 1 and Step 2 fields.
- Real-time validation as the user types.
- `maxPerContributor` accepts an empty value (no cap) but rejects non-integers and values ≤ 0.

### 3. CreateCampaignForm.a11y.test.tsx (Accessibility)
- Runs an axe audit against each step (Basics, Funding, Rewards with a tier added, Review with an API error) in both light and dark themes.

### 4. validation.test.ts (Utility Function Tests)
Unit tests for `validateStellarAccount`, `validateTitle`, `validateDescription`, `validateTargetAmount`, `validateDeadlineHours`, `validateForm`, and `isFormValid`.

## Running Tests
```bash
# Run all tests
npm test

# Run a specific test file
npm test CreateCampaignForm.test.tsx

# Run tests in watch mode
npm test -- --watch
```
