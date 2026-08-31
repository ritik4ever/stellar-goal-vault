import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, CreateCampaignPayload } from '../types/campaign';
import {
  FormErrors,
  validateCategory,
  validateDeadlineHours,
  validateDescription,
  validateMaxPerContributor,
  validateStellarAccount,
  validateTargetAmount,
  validateTitle,
} from '../utils/validation';

interface CreateCampaignFormProps {
  onCreate: (payload: CreateCampaignPayload) => Promise<void>;
  allowedAssets?: string[];
  apiError?: ApiError | null;
}

interface RewardTier {
  id: string;
  title: string;
  minAmount: string;
  description: string;
}

interface WizardValues {
  creator: string;
  title: string;
  description: string;
  category: string;
  acceptedTokens: string[];
  targetAmount: string;
  deadlineHours: string;
  maxPerContributor: string;
  imageUrl: string;
  externalLink: string;
  rewardTiers: RewardTier[];
}

const CATEGORY_OPTIONS = ['Community', 'Technology', 'Creative', 'Education', 'Charity', 'Other'];

const STEPS = [
  { key: 'basics', label: 'Basics' },
  { key: 'funding', label: 'Funding' },
  { key: 'rewards', label: 'Rewards' },
  { key: 'review', label: 'Review' },
] as const;

const STEP_FIELDS: Record<number, Array<keyof FormErrors>> = {
  0: ['creator', 'title', 'description', 'category'],
  1: ['acceptedTokens', 'targetAmount', 'deadlineHours', 'maxPerContributor'],
  2: [],
  3: [],
};

const INITIAL_VALUES: WizardValues = {
  creator: '',
  title: '',
  description: '',
  category: '',
  acceptedTokens: [],
  targetAmount: '250',
  deadlineHours: '72',
  maxPerContributor: '',
  imageUrl: '',
  imageFile: null as File | null,
  imagePreview: '',
  externalLink: '',
  rewardTiers: [],
};

function computeErrors(values: WizardValues): FormErrors {
  const errors: FormErrors = {};

  const creatorError = validateStellarAccount(values.creator);
  if (creatorError) {
    errors.creator = creatorError;
  }

  const titleError = validateTitle(values.title);
  if (titleError) {
    errors.title = titleError;
  }

  const descriptionError = validateDescription(values.description);
  if (descriptionError) {
    errors.description = descriptionError;
  }

  const categoryError = validateCategory(values.category);
  if (categoryError) {
    errors.category = categoryError;
  }

  if (!values.acceptedTokens || values.acceptedTokens.length === 0) {
    errors.acceptedTokens = 'At least one accepted token is required';
  }

  const amountError = validateTargetAmount(values.targetAmount);
  if (amountError) {
    errors.targetAmount = amountError;
  }

  const deadlineError = validateDeadlineHours(values.deadlineHours);
  if (deadlineError) {
    errors.deadlineHours = deadlineError;
  }

  const maxPerContributorError = validateMaxPerContributor(values.maxPerContributor);
  if (maxPerContributorError) {
    errors.maxPerContributor = maxPerContributorError;
  }

  return errors;
}

function validateRewardTier(tier: RewardTier): { title?: string; minAmount?: string } {
  const errors: { title?: string; minAmount?: string } = {};

  if (!tier.title.trim()) {
    errors.title = 'Reward title is required';
  }

  if (!tier.minAmount.trim()) {
    errors.minAmount = 'Minimum pledge amount is required';
  } else {
    const amount = Number(tier.minAmount);
    if (isNaN(amount) || amount <= 0) {
      errors.minAmount = 'Minimum pledge amount must be greater than zero';
    }
  }

  return errors;
}

function isStepValid(index: number, errors: FormErrors, values: WizardValues): boolean {
  if (index === 2) {
    return values.rewardTiers.every((tier) => Object.keys(validateRewardTier(tier)).length === 0);
  }

  const fields = STEP_FIELDS[index] ?? [];
  return fields.every((field) => !errors[field]);
}

export function CreateCampaignForm({
  onCreate,
  allowedAssets = [],
  apiError,
}: CreateCampaignFormProps) {
  const assetOptions = allowedAssets.length > 0 ? allowedAssets : ['USDC'];
  const [values, setValues] = useState<WizardValues>({
    ...INITIAL_VALUES,
    acceptedTokens: assetOptions.slice(0, 1),
  });
  const [touchedFields, setTouchedFields] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [maxStepReached, setMaxStepReached] = useState(0);
  const nextTierId = useRef(0);

  const errors = useMemo(() => computeErrors(values), [values]);

  useEffect(() => {
    setValues((current) => {
      const validTokens = current.acceptedTokens.filter((token) => assetOptions.includes(token));
      if (validTokens.length === current.acceptedTokens.length && validTokens.length > 0) {
        return current;
      }

      return {
        ...current,
        acceptedTokens: validTokens.length > 0 ? validTokens : assetOptions.slice(0, 1),
      };
    });
  }, [assetOptions.join(',')]);

  function update(field: keyof WizardValues, value: unknown) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  function handleFieldBlur(field: string) {
    setTouchedFields((prev) => new Set(prev).add(field));
  }

  function toggleToken(token: string) {
    setValues((current) => {
      const nextTokens = current.acceptedTokens.includes(token)
        ? current.acceptedTokens.filter((t) => t !== token)
        : [...current.acceptedTokens, token];
      return { ...current, acceptedTokens: nextTokens };
    });
  }

  function addRewardTier() {
    const id = `tier-${nextTierId.current}`;
    nextTierId.current += 1;
    setValues((current) => ({
      ...current,
      rewardTiers: [...current.rewardTiers, { id, title: '', minAmount: '', description: '' }],
    }));
  }

  function removeRewardTier(id: string) {
    setValues((current) => ({
      ...current,
      rewardTiers: current.rewardTiers.filter((tier) => tier.id !== id),
    }));
  }

  function updateRewardTier(id: string, field: 'title' | 'minAmount' | 'description', value: string) {
    setValues((current) => ({
      ...current,
      rewardTiers: current.rewardTiers.map((tier) =>
        tier.id === id ? { ...tier, [field]: value } : tier,
      ),
    }));
  }

  function handleTierFieldBlur(id: string, field: 'title' | 'minAmount') {
    setTouchedFields((prev) => new Set(prev).add(`tier-${id}-${field}`));
  }

  function markStepTouched(index: number) {
    setTouchedFields((prev) => {
      const next = new Set(prev);
      (STEP_FIELDS[index] ?? []).forEach((field) => next.add(field));
      if (index === 2) {
        values.rewardTiers.forEach((tier) => {
          next.add(`tier-${tier.id}-title`);
          next.add(`tier-${tier.id}-minAmount`);
        });
      }
      return next;
    });
  }

  function goNext() {
    markStepTouched(currentStep);
    if (!isStepValid(currentStep, errors, values)) {
      return;
    }
    const next = Math.min(currentStep + 1, STEPS.length - 1);
    setCurrentStep(next);
    setMaxStepReached((prev) => Math.max(prev, next));
  }

  function goBack() {
    setCurrentStep((prev) => Math.max(prev - 1, 0));
  }

  function goToStep(index: number) {
    if (index <= maxStepReached) {
      setCurrentStep(index);
    }
  }

  const reviewDeadlineLabel = useMemo(() => {
    const hours = Number(values.deadlineHours);
    if (!values.deadlineHours || isNaN(hours) || hours <= 0) {
      return '—';
    }
    const deadlineDate = new Date(Date.now() + hours * 3600 * 1000);
    return `${values.deadlineHours} hours (around ${deadlineDate.toLocaleString()})`;
  }, [values.deadlineHours]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    [0, 1, 2].forEach(markStepTouched);

    const firstInvalidStep = [0, 1, 2].find((index) => !isStepValid(index, errors, values));
    if (firstInvalidStep !== undefined) {
      setCurrentStep(firstInvalidStep);
      setMaxStepReached((prev) => Math.max(prev, firstInvalidStep));
      return;
    }

    setIsSubmitting(true);
    try {
      const deadline = Math.floor(Date.now() / 1000) + Number(values.deadlineHours) * 3600;

      // Use uploaded image (base64) if available, otherwise fall back to URL
      const finalImageUrl = values.imagePreview || values.imageUrl.trim() || undefined;

      await onCreate({
        creator: values.creator.trim(),
        title: values.title.trim(),
        description: values.description.trim(),
        acceptedTokens: values.acceptedTokens.map((t) => t.trim().toUpperCase()),
        targetAmount: Number(values.targetAmount),
        deadline,
        metadata: {
          imageUrl: finalImageUrl,
          externalLink: values.externalLink.trim() || undefined,
        },
        maxPerContributor: values.maxPerContributor.trim()
          ? Number(values.maxPerContributor)
          : undefined,
      });

      const resetValues: WizardValues = {
        ...INITIAL_VALUES,
        acceptedTokens: assetOptions.slice(0, 1),
      };
      setValues(resetValues);
      setTouchedFields(new Set());
      setCurrentStep(0);
      setMaxStepReached(0);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="card wizard-card">
      <div className="section-heading">
        <h2>Create Campaign</h2>
        <p className="muted">
          Spin up a Stellar goal vault for contributors and prototype the funding lifecycle.
        </p>
      </div>

      <nav className="wizard-stepper" aria-label="Campaign creation steps">
        <ol>
          {STEPS.map((step, index) => {
            const isCurrent = index === currentStep;
            const isComplete = index < currentStep;
            const isClickable = index <= maxStepReached;

            return (
              <li
                key={step.key}
                className={`wizard-step${isCurrent ? ' wizard-step-current' : ''}${
                  isComplete ? ' wizard-step-complete' : ''
                }`}
              >
                <button
                  type="button"
                  className="wizard-step-button"
                  onClick={() => goToStep(index)}
                  disabled={!isClickable}
                  aria-current={isCurrent ? 'step' : undefined}
                >
                  <span className="wizard-step-index" aria-hidden="true">
                    {isComplete ? '✓' : index + 1}
                  </span>
                  <span className="wizard-step-label">{step.label}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <form className="form-grid wizard-step-panel" onSubmit={handleSubmit} noValidate>
        {currentStep === 0 ? (
          <>
            <label className="field-group">
              <span>Creator account</span>
              <input
                type="text"
                value={values.creator}
                onChange={(event) => update('creator', event.target.value)}
                onBlur={() => handleFieldBlur('creator')}
                placeholder="G... creator public key"
                className={errors.creator && touchedFields.has('creator') ? 'input-error' : ''}
                required
              />
              {errors.creator && touchedFields.has('creator') ? (
                <span className="field-error">{errors.creator}</span>
              ) : null}
            </label>

            <label className="field-group">
              <span>Campaign title</span>
              <input
                type="text"
                value={values.title}
                onChange={(event) => update('title', event.target.value)}
                onBlur={() => handleFieldBlur('title')}
                placeholder="Stellar community design sprint"
                minLength={4}
                maxLength={80}
                className={errors.title && touchedFields.has('title') ? 'input-error' : ''}
                required
              />
              {errors.title && touchedFields.has('title') ? (
                <span className="field-error">{errors.title}</span>
              ) : null}
            </label>

            <label className="field-group">
              <span>Description</span>
              <textarea
                value={values.description}
                onChange={(event) => update('description', event.target.value)}
                onBlur={() => handleFieldBlur('description')}
                placeholder="Describe what the campaign funds, who benefits, and the delivery plan."
                rows={5}
                minLength={20}
                maxLength={500}
                className={errors.description && touchedFields.has('description') ? 'input-error' : ''}
                required
              />
              {errors.description && touchedFields.has('description') ? (
                <span className="field-error">{errors.description}</span>
              ) : null}
            </label>

            <label className="field-group">
              <span>Category</span>
              <select
                value={values.category}
                onChange={(event) => update('category', event.target.value)}
                onBlur={() => handleFieldBlur('category')}
                className={errors.category && touchedFields.has('category') ? 'input-error' : ''}
                required
              >
                <option value="" disabled>
                  Select a category
                </option>
                {CATEGORY_OPTIONS.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
              {errors.category && touchedFields.has('category') ? (
                <span className="field-error">{errors.category}</span>
              ) : null}
            </label>

            <div className="row">
              <label className="field-group">
                <span>Image URL (optional)</span>
                <input
                  type="url"
                  value={values.imageUrl}
                  onChange={(event) => update('imageUrl', event.target.value)}
                  placeholder="https://example.com/image.png"
                />
              </label>

              <label className="field-group">
                <span>External Link (optional)</span>
                <input
                  type="url"
                  value={values.externalLink}
                  onChange={(event) => update('externalLink', event.target.value)}
                  placeholder="https://example.com/project"
                />
              </label>
            </div>
          </>
        ) : null}

        {currentStep === 1 ? (
          <>
            <div className="field-group">
              <span>Accepted tokens</span>
              <div className="token-checkboxes">
                {assetOptions.map((asset) => (
                  <label key={asset} className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={values.acceptedTokens.includes(asset)}
                      onChange={() => toggleToken(asset)}
                      onBlur={() => handleFieldBlur('acceptedTokens')}
                    />
                    {asset}
                  </label>
                ))}
              </div>
              {errors.acceptedTokens && touchedFields.has('acceptedTokens') ? (
                <span className="field-error">{errors.acceptedTokens}</span>
              ) : null}
            </div>

            <label className="field-group">
              <span>Target amount (cumulative sum of units)</span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={values.targetAmount}
                onChange={(event) => update('targetAmount', event.target.value)}
                onBlur={() => handleFieldBlur('targetAmount')}
                className={errors.targetAmount && touchedFields.has('targetAmount') ? 'input-error' : ''}
                required
              />
              {errors.targetAmount && touchedFields.has('targetAmount') ? (
                <span className="field-error">{errors.targetAmount}</span>
              ) : null}
            </label>

            <label className="field-group">
              <span>Deadline in hours</span>
              <input
                type="number"
                min="0.0001"
                step="0.0001"
                value={values.deadlineHours}
                onChange={(event) => update('deadlineHours', event.target.value)}
                onBlur={() => handleFieldBlur('deadlineHours')}
                className={errors.deadlineHours && touchedFields.has('deadlineHours') ? 'input-error' : ''}
                required
              />
              {errors.deadlineHours && touchedFields.has('deadlineHours') ? (
                <span className="field-error">{errors.deadlineHours}</span>
              ) : null}
            </label>

            <label className="field-group">
              <span>Max per contributor (optional)</span>
              <input
                type="number"
                min="1"
                step="1"
                value={values.maxPerContributor}
                onChange={(event) => update('maxPerContributor', event.target.value)}
                onBlur={() => handleFieldBlur('maxPerContributor')}
                placeholder="No limit"
                className={
                  errors.maxPerContributor && touchedFields.has('maxPerContributor')
                    ? 'input-error'
                    : ''
                }
              />
              {errors.maxPerContributor && touchedFields.has('maxPerContributor') ? (
                <span className="field-error">{errors.maxPerContributor}</span>
              ) : null}
            </label>
          </>
        ) : null}

        {currentStep === 2 ? (
          <div className="field-group">
            <span>Reward tiers (optional)</span>
            <p className="muted wizard-hint">
              Offer contributors a reward for pledging above a minimum amount. Skip this step if
              you don&apos;t need tiers.
            </p>

            {values.rewardTiers.length === 0 ? (
              <p className="muted">No reward tiers added yet.</p>
            ) : (
              <ul className="reward-tier-list">
                {values.rewardTiers.map((tier, index) => {
                  const tierErrors = validateRewardTier(tier);
                  const titleTouched = touchedFields.has(`tier-${tier.id}-title`);
                  const amountTouched = touchedFields.has(`tier-${tier.id}-minAmount`);

                  return (
                    <li key={tier.id} className="reward-tier-row">
                      <div className="reward-tier-row-header">
                        <span>Tier {index + 1}</span>
                        <button
                          type="button"
                          className="btn-ghost btn-small"
                          onClick={() => removeRewardTier(tier.id)}
                        >
                          Remove
                        </button>
                      </div>

                      <label className="field-group">
                        <span>Reward title</span>
                        <input
                          type="text"
                          value={tier.title}
                          onChange={(event) => updateRewardTier(tier.id, 'title', event.target.value)}
                          onBlur={() => handleTierFieldBlur(tier.id, 'title')}
                          placeholder="Early supporter badge"
                          className={tierErrors.title && titleTouched ? 'input-error' : ''}
                        />
                        {tierErrors.title && titleTouched ? (
                          <span className="field-error">{tierErrors.title}</span>
                        ) : null}
                      </label>

                      <label className="field-group">
                        <span>Minimum pledge amount</span>
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={tier.minAmount}
                          onChange={(event) =>
                            updateRewardTier(tier.id, 'minAmount', event.target.value)
                          }
                          onBlur={() => handleTierFieldBlur(tier.id, 'minAmount')}
                          className={tierErrors.minAmount && amountTouched ? 'input-error' : ''}
                        />
                        {tierErrors.minAmount && amountTouched ? (
                          <span className="field-error">{tierErrors.minAmount}</span>
                        ) : null}
                      </label>

                      <label className="field-group">
                        <span>Description (optional)</span>
                        <textarea
                          value={tier.description}
                          onChange={(event) =>
                            updateRewardTier(tier.id, 'description', event.target.value)
                          }
                          placeholder="What contributors receive at this tier"
                          rows={3}
                        />
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}

            <button type="button" className="btn-ghost" onClick={addRewardTier}>
              + Add reward tier
            </button>
          </div>
        ) : null}

        {currentStep === 3 ? (
          <div className="wizard-review">
            <div className="review-block">
              <h3>Basics</h3>
              <dl>
                <dt>Title</dt>
                <dd>{values.title || '—'}</dd>
                <dt>Category</dt>
                <dd>{values.category || '—'}</dd>
                <dt>Description</dt>
                <dd>{values.description || '—'}</dd>
                <dt>Creator</dt>
                <dd className="mono">{values.creator || '—'}</dd>
              </dl>
              {values.imageUrl ? (
                <img src={values.imageUrl} alt="Campaign preview" className="review-image" />
              ) : null}
              {values.externalLink ? (
                <a href={values.externalLink} target="_blank" rel="noreferrer">
                  {values.externalLink}
                </a>
              ) : null}
            </div>

            <div className="review-block">
              <h3>Funding</h3>
              <dl>
                <dt>Accepted tokens</dt>
                <dd>{values.acceptedTokens.join(', ') || '—'}</dd>
                <dt>Target amount</dt>
                <dd>{values.targetAmount || '—'}</dd>
                <dt>Deadline</dt>
                <dd>{reviewDeadlineLabel}</dd>
                <dt>Max per contributor</dt>
                <dd>{values.maxPerContributor || 'No limit'}</dd>
              </dl>
            </div>

            <div className="review-block">
              <h3>Reward tiers</h3>
              {values.rewardTiers.length === 0 ? (
                <p className="muted">No reward tiers.</p>
              ) : (
                <ul className="reward-tier-review-list">
                  {values.rewardTiers.map((tier, index) => (
                    <li key={tier.id}>
                      <strong>{tier.title || `Tier ${index + 1}`}</strong> — from{' '}
                      {tier.minAmount || '0'} {values.acceptedTokens[0] ?? ''}
                      {tier.description ? <p className="muted">{tier.description}</p> : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {apiError ? (
              <div className="form-error">
                <p>{apiError.message}</p>
                {apiError.details && apiError.details.length > 0 ? (
                  <ul className="error-details">
                    {apiError.details.map((detail, index) => (
                      <li key={`${detail.field}-${index}`}>
                        <strong>{detail.field}:</strong> {detail.message}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {apiError.code ? (
                  <small className="error-meta">
                    Code: {apiError.code}
                    {apiError.requestId ? ` | Request ID: ${apiError.requestId}` : ''}
                  </small>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="wizard-nav">
          {currentStep > 0 ? (
            <button type="button" className="btn-ghost" onClick={goBack}>
              Back
            </button>
          ) : (
            <span />
          )}

          {currentStep < STEPS.length - 1 ? (
            <button type="button" className="btn-primary" onClick={goNext}>
              Next
            </button>
          ) : (
            <button className="btn-primary" type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Creating...' : 'Create campaign'}
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
