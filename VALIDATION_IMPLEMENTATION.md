# Validation Implementation Guide

## Overview
This document outlines the validation system for Stellar Goal Vault, covering both frontend form validation and backend API validation using Zod schemas. The system provides immediate user feedback on the frontend and robust request validation on the backend.

## Architecture Overview

The validation system operates at two layers:

### Frontend Validation (`frontend/src/utils/validation.ts`)
- Provides immediate user feedback during form input
- Mirrors backend validation rules for consistency
- Prevents invalid API calls by catching errors client-side
- Uses custom validation functions with regex patterns

### Backend Validation (`backend/src/validation/`)
- Uses Zod schemas for robust request validation
- Applied via `validateBody` middleware on API endpoints
- Includes SSRF protection for URL fields
- Stellar address validation with CRC checksum verification
- Query parameter parsing and validation

## Backend Zod Schemas

Located in `backend/src/validation/schemas.ts`, these schemas define the validation rules for all API endpoints.

### Core Regex Patterns
```typescript
export const STELLAR_ACCOUNT_REGEX = /^G[A-Z2-7]{55}$/;
export const ASSET_CODE_REGEX = /^[A-Za-z0-9]{1,12}$/;
export const CAMPAIGN_ID_REGEX = /^[1-9]\d*$/;
export const TX_HASH_REGEX = /^[A-Fa-f0-9]{64}$/;
```

### Reusable Schemas

#### `stellarAccountIdSchema`
- Validates Stellar public key format (56 chars, starts with G)
- Uses regex pattern matching
- Error: "Must be a valid Stellar account ID (starts with G and is exactly 56 characters)"

#### `assetCodeSchema`
- Validates asset codes (1-12 alphanumeric characters)
- Transforms to uppercase
- Refines against `config.allowedAssets` list
- Error: "Asset code is not supported. Supported assets: X, Y, Z"

#### `positiveAmountSchema`
- Coerces to number
- Must be finite and positive
- Error: "Amount must be greater than zero"

#### `unixTimestampSchema`
- Coerces to number
- Must be positive integer
- Error: "deadline must be a valid UNIX timestamp in seconds"

#### `httpsOnlyUrlSchema`
- Enforces HTTPS-only protocol
- Blocks private/loopback IP addresses
- Rejects URLs with userinfo (username/password)
- Max length: 2048 characters
- Part of SSRF protection (see `urlSafety.ts`)

### Request Payload Schemas

#### `createCampaignPayloadSchema`
```typescript
{
  creator: stellarAccountIdSchema,
  title: z.string().trim().min(4).max(80),
  description: z.string().trim(). min(20).max(500),
  acceptedTokens: z.array(assetCodeSchema).min(1),
  targetAmount: positiveAmountSchema,
  deadline: unixTimestampSchema,
  metadata: {
    imageUrl: httpsOnlyUrlSchema.optional(),
    externalLink: httpsOnlyUrlSchema.optional()
  }.optional(),
  maxPerContributor: optionalPositiveIntSchema
}
```

#### `createPledgePayloadSchema`
```typescript
{
  contributor: stellarAccountIdSchema,
  amount: positiveAmountSchema,
  assetCode: assetCodeSchema
}
```

#### `reconcilePledgePayloadSchema`
```typescript
{
  contributor: stellarAccountIdSchema,
  amount: positiveAmountSchema,
  assetCode: assetCodeSchema,
  transactionHash: z.string().regex(TX_HASH_REGEX),
  confirmedAt: unixTimestampSchema.optional()
}
```

#### `claimCampaignPayloadSchema`
```typescript
{
  creator: stellarAccountIdSchema,
  transactionHash: z.string().regex(TX_HASH_REGEX),
  confirmedAt: unixTimestampSchema.optional()
}
```

#### `refundPayloadSchema`
```typescript
{
  contributor: stellarAccountIdSchema,
  soroban: {
    txHash: stellarTransactionHashSchema,
    contractId: z.string().min(1),
    networkPassphrase: z.string().min(1),
    rpcUrl: z.string().url(),
    walletAddress: stellarAccountIdSchema,
    ledger: z.coerce.number().int().positive().optional(),
    createdAt: unixTimestampSchema.optional(),
    latestLedger: z.coerce.number().int().positive().optional()
  }
}
```

### Query Parameter Parsing Functions

#### `parseCampaignListPaginationQuery`
- Validates `page` and `limit` query parameters
- Both must be provided together or omitted together
- `page`: positive integer
- `limit`: integer from 1 to 100
- Returns `{ ok: true, page?, limit? }` or `{ ok: false, issues }`

#### `parseHistoryPaginationQuery`
- Validates `page` and `pageSize` for campaign history
- Defaults: page=1, pageSize=20
- `pageSize` max: 100

#### `parsePledgeListPaginationQuery`
- Validates `page` and `limit` for pledge lists
- Defaults: page=1, limit=10
- `limit` max: 100

## Frontend Validation

Located in `frontend/src/utils/validation.ts`, these functions mirror backend rules for client-side validation.

### Validation Functions

#### `validateStellarAccount(address: string)`
- Checks format: 56 characters, starts with 'G', A-Z2-7 only
- Error: "Invalid Stellar account format (must contain only A-Z and 2-7)"

#### `validateTitle(title: string)`
- Length: 4-80 characters
- Error: "Title must be between 4 and 80 characters"

#### `validateDescription(description: string)`
- Length: 20-500 characters
- Error: "Description must be between 20 and 500 characters"

#### `validateTargetAmount(amount: number)`
- Must be valid number
- Must be greater than zero
- Must be at least 0.01
- Errors: "Amount must be a valid number", "Amount must be greater than zero", "Amount must be at least 0.01"

#### `validateDeadlineHours(hours: number)`
- Must be whole number
- Must be at least 1 hour
- Must not exceed 8760 hours (365 days)
- Errors: "Deadline must be a whole number", "Deadline must be at least 1 hour", "Deadline cannot exceed 365 days"

#### `validateForm(values: FormValues)`
- Batch validates all form fields
- Returns object with field names as keys and error messages as values

#### `isFormValid(errors: FormErrors)`
- Checks if any errors exist in the errors object

## Specialized Validation Modules

### Stellar Address Validation (`backend/src/validation/stellarAddress.ts`)
- Replicates `StrKey.isValidEd25519PublicKey` from Stellar SDK
- Validates Base32 encoding with CRC-16/XModem checksum
- Checks version byte (0x30 for Ed25519 public key)
- Function: `isValidStellarPublicKey(address: string)`

### SSRF Protection (`backend/src/validation/urlSafety.ts`)
- Two-layer defense against Server-Side Request Forgery
- **Layer 1**: `httpsOnlyUrlSchema` - synchronous schema validation
  - Rejects non-HTTPS protocols
  - Blocks private/loopback IP literals
  - Rejects URLs with userinfo
- **Layer 2**: `assertSafeRemoteUrl` - runtime DNS resolution
  - Resolves hostnames and checks against private CIDRs
  - Defends against DNS rebinding attacks
- Blocked ranges include: 0.0.0.0/8, 10.0.0.0/8, 127.0.0.0/8, 169.254.0.0/16, 172.16.0.0/12, 192.168.0.0/16, and IPv6 equivalents

## Validation Middleware

### `validateBody` (`backend/src/middleware/validateBody.ts`)
Express middleware that validates request bodies against Zod schemas:

```typescript
import { validateBody } from './middleware/validateBody';
import { createCampaignPayloadSchema } from './validation/schemas';

app.post('/api/campaigns', validateBody(createCampaignPayloadSchema), handler);
```

- Uses `safeParseAsync` for async schema support
- Replaces `req.body` with parsed/transformed data on success
- Returns 400 with `{ error: 'Validation failed', details: ZodIssue[] }` on failure
- Designed for POST/PATCH routes with JSON payloads

## Frontend Form Validation Implementation

### Acceptance Criteria - Addressed

### ✅ Invalid creator accounts show inline field errors
- **Implementation**: The creator account field now validates against Stellar address format (56 characters starting with 'G', containing only A-Z and 2-7)
- **User Experience**: Error messages appear below the field as the user types
- **Example Error**: "Invalid Stellar account format (must contain only A-Z and 2-7)"

### ✅ Amount and deadline fields show human-readable validation messages
- **Amount Field** validates:
  - Value is a valid number
  - Amount is greater than zero
  - Amount is at least 0.01 (minimum)
  - Example: "Amount must be at least 0.01"
  
- **Deadline Field** validates:
  - Value is a whole number
  - Hours is at least 1
  - Hours does not exceed 365 days (8760 hours)
  - Example: "Deadline cannot exceed 365 days"

### ✅ The submit button is blocked when required fields are invalid
- **Implementation**: Submit button is disabled when:
  - Form has any validation errors
  - Form is currently submitting
- **Visual Feedback**: The button shows reduced opacity and cursor changes to "not-allowed"

### ✅ Error states are visually consistent with the rest of the UI
- **Color Scheme**: Uses red/error color (#f87171) consistent with the design system
- **Field Styling**: 
  - Red border around fields with errors
  - Subtle red background (rgba(127, 29, 29, 0.1))
  - Red glow on focus to maintain visual consistency
- **Error Message Text**: 
  - Font size: 0.8125rem (smaller than field label but visible)
  - Color: #f87171
  - Font weight: 500 (medium weight for emphasis)
  - Positioned below field with 6px margin

## How to Add Validation for New Endpoints

### Step 1: Define the Zod Schema

Add your schema to `backend/src/validation/schemas.ts`:

```typescript
export const newEndpointPayloadSchema = z.object({
  // Use existing reusable schemas where possible
  accountId: stellarAccountIdSchema,
  amount: positiveAmountSchema,
  
  // Or define custom validation
  customField: z
    .string()
    .trim()
    .min(1, 'Custom field is required')
    .max(100, 'Custom field must not exceed 100 characters'),
  
  // For optional fields
  optionalField: z.string().optional(),
  
  // For URLs with SSRF protection
  userUrl: httpsOnlyUrlSchema.optional(),
});
```

### Step 2: Apply the Middleware

In `backend/src/index.ts`, add the `validateBody` middleware to your route:

```typescript
import { validateBody } from './middleware/validateBody';
import { newEndpointPayloadSchema } from './validation/schemas';

app.post(
  '/api/new-endpoint',
  validateBody(newEndpointPayloadSchema),
  (req: Request, res: Response) => {
    // req.body is now typed and validated
    const body = req.body as z.infer<typeof newEndpointPayloadSchema>;
    // Your handler logic here
  }
);
```

### Step 3: Add Frontend Validation (if applicable)

If the endpoint has a corresponding form, add validation to `frontend/src/utils/validation.ts`:

```typescript
export function validateCustomField(value: string): string | undefined {
  if (!value || value.trim().length === 0) {
    return 'Custom field is required';
  }
  if (value.length > 100) {
    return 'Custom field must not exceed 100 characters';
  }
  return undefined;
}
```

### Step 4: Add Tests

Create tests in `backend/src/validation/schemas.test.ts`:

```typescript
describe('newEndpointPayloadSchema', () => {
  it('accepts valid payload', () => {
    const result = newEndpointPayloadSchema.safeParse({
      accountId: 'GABCD...',
      amount: 100,
      customField: 'valid value',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid Stellar account', () => {
    const result = newEndpointPayloadSchema.safeParse({
      accountId: 'invalid',
      amount: 100,
      customField: 'valid value',
    });
    expect(result.success).toBe(false);
  });
});
```

### Step 5: Update OpenAPI Documentation

If using OpenAPI, the schema will automatically be documented via `extendZodWithOpenApi(z)` at the top of `schemas.ts`.

## Best Practices

1. **Reuse Existing Schemas**: Always use `stellarAccountIdSchema`, `positiveAmountSchema`, etc. instead of redefining common patterns.

2. **Coerce Types**: Use `z.coerce.number()` for numeric fields to handle string inputs from forms.

3. **Trim Strings**: Always use `.trim()` on string fields to prevent whitespace-related issues.

4. **SSRF Protection**: For any user-supplied URLs, use `httpsOnlyUrlSchema` and pair with `assertSafeRemoteUrl` at fetch time.

5. **Error Messages**: Provide clear, actionable error messages that help users fix validation issues.

6. **Query Parameters**: Use the existing parsing functions (`parseCampaignListPaginationQuery`, etc.) as templates for new query parameter validators.

7. **Test Coverage**: Always add tests for both valid and invalid inputs, including boundary conditions.

## File Structure

### New Files Created

1. **`frontend/src/utils/validation.ts`**
   - Core validation utilities mirroring backend schema rules
   - Provides individual validation functions for each field
   - Includes batch validation for entire form
   - All error messages are user-friendly and specific

2. **`frontend/src/utils/validation.test.ts`**
   - Comprehensive unit tests for all validation functions
   - Tests both valid and invalid inputs
   - Tests boundary conditions (min/max values)
   - ~50 test cases covering all scenarios

3. **`frontend/src/components/CreateCampaignForm.validation.test.tsx`**
   - Integration tests for form UI validation behavior
   - Tests error display, button state, and styling
   - Tests real-time validation feedback
   - Tests form submission flow

### Modified Files

1. **`frontend/src/components/CreateCampaignForm.tsx`**
   - Added validation state management
   - Integrated real-time validation on field changes
   - Added inline error display under each field
   - Applied error CSS classes to invalid fields
   - Disabled submit button when form is invalid

2. **`frontend/src/index.css`**
   - Added `.input-error` class for field styling
   - Added `.field-error` class for error message styling
   - Error states use red color (#f87171) with transparent background

## Validation Rules

### Creator Account (Stellar Address)
- **Required**: Yes
- **Format**: Must match `^G[A-Z2-7]{55}$` (56 characters total)
- **Validations**:
  - Not empty
  - Exactly 56 characters
  - Starts with 'G'
  - Contains only A-Z and 2-7

### Campaign Title
- **Required**: Yes
- **Length**: 4-80 characters
- **Validations**:
  - Not empty
  - Minimum 4 characters
  - Maximum 80 characters

### Description
- **Required**: Yes
- **Length**: 20-500 characters
- **Validations**:
  - Not empty
  - Minimum 20 characters
  - Maximum 500 characters

### Target Amount
- **Required**: Yes
- **Type**: Number
- **Validations**:
  - Valid number (no text)
  - Greater than zero
  - Minimum 0.01
  - Uses HTML `type="number"` with `step="0.01"` and `min="0.01"`

### Deadline (Hours)
- **Required**: Yes
- **Type**: Integer
- **Validations**:
  - Valid whole number (no decimals)
  - At least 1 hour
  - Maximum 8760 hours (365 days)
  - Uses HTML `type="number"` with `step="1"` and `min="1"`

### Asset Code (Optional Select)
- **Default**: First allowed asset
- **Validation**: No client-side validation (backend validates against allowed list)

### Image URL & External Link (Optional)
- **Validation**: HTML5 URL validation via `type="url"` attribute
- **Not validated on submit** (optional fields are skipped in batch validation)

## Technical Implementation Details

### Validation Flow

1. **On Field Change (Real-time)**:
   ```typescript
   function update(field, value) {
     setValues({ ...values, [field]: value });
     const newErrors = validateForm(updatedValues);
     setValidationErrors(newErrors);
   }
   ```
   - Validates entire form after each field change
   - Provides immediate feedback to user
   - Error messages appear/disappear as user types

2. **On Form Submit**:
   ```typescript
   async function handleSubmit(event) {
     const errors = validateForm(values);
     setValidationErrors(errors);
     
     if (!isFormValid(errors)) return;
     // Only proceed if no errors
   }
   ```
   - Validates before submission
   - Prevents API call if validation fails
   - User can correct errors and retry

3. **Error Display**:
   ```tsx
   {validationErrors.creator ? (
     <span className="field-error">{validationErrors.creator}</span>
   ) : null}
   ```
   - Conditionally renders error message below field
   - Only shows when field has error
   - Message is specific to the validation rule that failed

### State Management

```typescript
const [validationErrors, setValidationErrors] = useState<FormErrors>({});
```

- `FormErrors` type maps field names to error messages (or undefined)
- Empty object `{}` means no errors
- `isFormValid(errors)` checks if any error exists

## User Experience Flow

### Scenario 1: User enters invalid Stellar address

1. User focuses on Creator Account field
2. User types "invalid_address"
3. Realtime validation triggers:
   - "Invalid Stellar account format (must contain only A-Z and 2-7)" error appears
4. Submit button becomes disabled
5. User corrects the address to valid format (e.g., "G" + valid characters)
6. Error disappears immediately
7. Submit button becomes enabled

### Scenario 2: User tries to submit with invalid data

1. User fills form with some invalid fields
2. User clicks "Create campaign" button
3. Validation runs again
4. All validation errors are displayed together
5. Form remains on page, allowing corrections
6. User fixes errors
7. User can now submit successfully

### Scenario 3: Real-time feedback on amount field

1. User focuses on Target Amount field
2. User types "0" 
3. "Amount must be greater than zero" appears
4. User changes to "0.001"
5. "Amount must be at least 0.01" appears
6. User changes to "100"
7. Error disappears, field is valid

## CSS Classes Reference

### Input Error State
- **Class**: `.input-error`
- **Applied to**: `<input>` or `<textarea>` elements
- **Border**: #f87171 (red)
- **Background**: rgba(127, 29, 29, 0.1) (dark red transparent)
- **Focus state**: Maintains red border with matching focus glow

### Error Message
- **Class**: `.field-error`
- **Font size**: 0.8125rem
- **Color**: #f87171 (red)
- **Font weight**: 500
- **Margin**: 6px top margin
- **Line height**: 1.4 for readability

## Validation Constants

Located in `frontend/src/utils/validation.ts`:

```typescript
export const STELLAR_ACCOUNT_REGEX = /^G[A-Z2-7]{55}$/;
export const MIN_TITLE_LENGTH = 4;
export const MAX_TITLE_LENGTH = 80;
export const MIN_DESCRIPTION_LENGTH = 20;
export const MAX_DESCRIPTION_LENGTH = 500;
export const MIN_TARGET_AMOUNT = 0.01;
export const MIN_DEADLINE_HOURS = 1;
```

These constants are maintained in sync with backend validation rules.

## API Integration

### Before Validation Implementation
- Form would submit immediately on button click
- Backend would return errors
- User would see server error messages

### After Validation Implementation
- Client validates immediately before sending request
- Reduces unnecessary API calls for invalid data
- Server-side validation still acts as final safeguard
- Better user experience with real-time feedback

## Browser Compatibility

- Uses HTML5 input attributes (`type="number"`, `min`, `step`)
- Uses flexbox and modern CSS (already required by app)
- Regular expressions for format validation
- Compatible with all modern browsers (Chrome, Firefox, Safari, Edge)

## Testing Strategy

### Unit Tests (`validation.test.ts`)
- Tests each validation function independently
- Tests boundary conditions
- Tests error message content
- 50+ test cases

### Integration Tests (`CreateCampaignForm.validation.test.tsx`)
- Tests error display in UI
- Tests button disabled state
- Tests CSS class application
- Tests real-time validation
- Tests form submission flow

### Manual Testing Recommendations
1. Test each field with valid and invalid inputs
2. Test rapid field changes to ensure real-time validation
3. Test submit button state transitions
4. Test error message visibility
5. Test form reset after successful submission

## Future Enhancements

Potential improvements for future iterations:
- Field-specific validation debouncing (for performance)
- Character count display for title/description fields
- Password strength indicator pattern (if needed)
- Async validation for unique campaign titles
- Accessibility improvements (aria-invalid, aria-describedby)
- Animated error transitions
- Toast notifications for submission success/failure

## Conclusion

This implementation provides a robust, user-friendly validation system that:
- ✅ Validates all required fields with specific, clear error messages
- ✅ Provides real-time feedback as users type
- ✅ Prevents invalid submissions with disabled button
- ✅ Maintains visual consistency with the design system
- ✅ Reduces unnecessary API calls for invalid data
- ✅ Improves overall user experience significantly

The validation rules are mirrored from the backend schema, ensuring client and server validation consistency.
