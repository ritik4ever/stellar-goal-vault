/**
 * Frontend validation utilities that mirror backend validation rules.
 * Provides user-friendly error messages and validation functions.
 */

export const STELLAR_ACCOUNT_REGEX = /^G[A-Z2-7]{55}$/;
export const MIN_TITLE_LENGTH = 4;
export const MAX_TITLE_LENGTH = 80;
export const MIN_DESCRIPTION_LENGTH = 20;
export const MAX_DESCRIPTION_LENGTH = 500;
export const MIN_TARGET_AMOUNT = 0.01;
export const MIN_DEADLINE_HOURS = 1;

export interface ValidationError {
  field: string;
  message: string;
}

export interface FormErrors {
  creator?: string;
  title?: string;
  description?: string;
  targetAmount?: string;
  deadlineHours?: string;
}

/**
 * Validates a Stellar account ID.
 */
export function validateStellarAccount(value: string): string | null {
  if (!value || !value.trim()) {
    return "Creator account is required";
  }

  const trimmed = value.trim();
  if (trimmed.length !== 56) {
    return "Stellar account must be exactly 56 characters";
  }

  if (!trimmed.startsWith("G")) {
    return "Stellar account must start with 'G'";
  }

  if (!STELLAR_ACCOUNT_REGEX.test(trimmed)) {
    return "Invalid Stellar account format (must contain only A-Z and 2-7)";
  }

  return null;
}

/**
 * Validates campaign title.
 */
export function validateTitle(value: string): string | null {
  if (!value || !value.trim()) {
    return "Campaign title is required";
  }

  const trimmed = value.trim();
  if (trimmed.length < MIN_TITLE_LENGTH) {
    return `Title must be at least ${MIN_TITLE_LENGTH} characters`;
  }

  if (trimmed.length > MAX_TITLE_LENGTH) {
    return `Title cannot exceed ${MAX_TITLE_LENGTH} characters`;
  }

  return null;
}

/**
 * Validates campaign description.
 */
export function validateDescription(value: string): string | null {
  if (!value || !value.trim()) {
    return "Campaign description is required";
  }

  const trimmed = value.trim();
  if (trimmed.length < MIN_DESCRIPTION_LENGTH) {
    return `Description must be at least ${MIN_DESCRIPTION_LENGTH} characters`;
  }

  if (trimmed.length > MAX_DESCRIPTION_LENGTH) {
    return `Description cannot exceed ${MAX_DESCRIPTION_LENGTH} characters`;
  }

  return null;
}

/**
 * Validates target amount for the campaign.
 */
export function validateTargetAmount(value: string | number): string | null {
  if (!value && value !== 0) {
    return "Target amount is required";
  }

  const amount = typeof value === "string" ? parseFloat(value) : value;

  if (isNaN(amount)) {
    return "Amount must be a valid number";
  }

  if (amount <= 0) {
    return "Amount must be greater than zero";
  }

  if (amount < MIN_TARGET_AMOUNT) {
    return `Amount must be at least ${MIN_TARGET_AMOUNT}`;
  }

  return null;
}

/**
 * Validates deadline hours.
 */
export function validateDeadlineHours(value: string | number): string | null {
  if (!value && value !== 0) {
    return "Deadline is required";
  }

  const hours = typeof value === "string" ? parseFloat(value) : value;

  if (isNaN(hours)) {
    return "Deadline must be a valid number";
  }

  if (hours < MIN_DEADLINE_HOURS) {
    return `Deadline must be at least ${MIN_DEADLINE_HOURS} hours`;
  }

  if (hours > 8760) {
    // 365 days
    return "Deadline cannot exceed 365 days";
  }

  return null;
}

/**
 * Validates all form fields and returns a map of errors.
 */
export function validateForm(formData: {
  creator: string;
  title: string;
  description: string;
  targetAmount: string;
  deadlineHours: string;
}): FormErrors {
  const errors: FormErrors = {};

  const creatorError = validateStellarAccount(formData.creator);
  if (creatorError) {
    errors.creator = creatorError;
  }

  const titleError = validateTitle(formData.title);
  if (titleError) {
    errors.title = titleError;
  }

  const descriptionError = validateDescription(formData.description);
  if (descriptionError) {
    errors.description = descriptionError;
  }

  const amountError = validateTargetAmount(formData.targetAmount);
  if (amountError) {
    errors.targetAmount = amountError;
  }

  const deadlineError = validateDeadlineHours(formData.deadlineHours);
  if (deadlineError) {
    errors.deadlineHours = deadlineError;
  }

  return errors;
}

/**
 * Checks if the form is valid (no errors).
 */
export function isFormValid(errors: FormErrors): boolean {
  return Object.values(errors).every((error) => !error);
}
