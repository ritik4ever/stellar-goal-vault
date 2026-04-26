# Frontend Campaign Form Validation Implementation

## Overview
This document outlines the enhanced frontend validation system for the Create Campaign Form, which provides immediate user feedback and prevents submission of invalid data.

## Acceptance Criteria - Addressed

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
