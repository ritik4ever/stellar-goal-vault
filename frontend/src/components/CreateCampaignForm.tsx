import { FormEvent, useState } from "react";
import { CreateCampaignPayload } from "../types/campaign";

interface CreateCampaignFormProps {
  onCreate: (payload: CreateCampaignPayload) => Promise<void>;
  apiError?: string | null;
}

const INITIAL_VALUES = {
  creator: "",
  title: "",
  description: "",
  assetCode: "USDC",
  targetAmount: "250",
  deadlineHours: "72",
  imageUrl: "",
  externalLink: "",
};

export function CreateCampaignForm({ onCreate, apiError }: CreateCampaignFormProps) {
  const [values, setValues] = useState(INITIAL_VALUES);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [allowedAssets, setAllowedAssets] = useState<string[]>([]);

  useEffect(() => {
    fetch("http://localhost:3001/api/config")
      .then((res) => res.json())
      .then((json) => {
        if (json.data?.allowedAssets) {
          setAllowedAssets(json.data.allowedAssets);
          if (json.data.allowedAssets.length > 0) {
            update("assetCode", json.data.allowedAssets[0]);
          }
        }
      })
      .catch(console.error);
  }, []);

  function update(field: keyof typeof INITIAL_VALUES, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);

    try {
      const deadline = Math.floor(Date.now() / 1000) + Number(values.deadlineHours) * 3600;
      await onCreate({
        creator: values.creator.trim(),
        title: values.title.trim(),
        description: values.description.trim(),
        assetCode: values.assetCode.trim().toUpperCase(),
        targetAmount: Number(values.targetAmount),
        deadline,
        metadata: {
          imageUrl: values.imageUrl.trim() || undefined,
          externalLink: values.externalLink.trim() || undefined,
        },
      });

      setValues(INITIAL_VALUES);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="card">
      <div className="section-heading">
        <h2>Create Campaign</h2>
        <p className="muted">Spin up a Stellar goal vault for contributors and prototype the funding lifecycle.</p>
      </div>

      <form className="form-grid" onSubmit={handleSubmit}>
        <label className="field-group">
          <span>Creator account</span>
          <input
            type="text"
            value={values.creator}
            onChange={(event) => update("creator", event.target.value)}
            placeholder="G... creator public key"
            required
          />
        </label>

        <label className="field-group">
          <span>Campaign title</span>
          <input
            type="text"
            value={values.title}
            onChange={(event) => update("title", event.target.value)}
            placeholder="Stellar community design sprint"
            minLength={4}
            maxLength={80}
            required
          />
        </label>

        <label className="field-group">
          <span>Description</span>
          <textarea
            value={values.description}
            onChange={(event) => update("description", event.target.value)}
            placeholder="Describe what the campaign funds, who benefits, and the delivery plan."
            rows={5}
            minLength={20}
            maxLength={500}
            required
          />
        </label>

        <div className="row">
          <label className="field-group">
            <span>Asset code</span>
            <select
              value={values.assetCode}
              onChange={(event) => update("assetCode", event.target.value)}
              required
            >
              {allowedAssets.map((asset) => (
                <option key={asset} value={asset}>
                  {asset}
                </option>
              ))}
              {allowedAssets.length === 0 && <option value="USDC">USDC</option>}
            </select>
          </label>

          <label className="field-group">
            <span>Target amount</span>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={values.targetAmount}
              onChange={(event) => update("targetAmount", event.target.value)}
              required
            />
          </label>
        </div>

        <label className="field-group">
          <span>Deadline in hours</span>
          <input
            type="number"
            min="1"
            step="1"
            value={values.deadlineHours}
            onChange={(event) => update("deadlineHours", event.target.value)}
            required
          />
        </label>

        <div className="row">
          <label className="field-group">
            <span>Image URL (optional)</span>
            <input
              type="url"
              value={values.imageUrl}
              onChange={(event) => update("imageUrl", event.target.value)}
              placeholder="https://example.com/image.png"
            />
          </label>

          <label className="field-group">
            <span>External Link (optional)</span>
            <input
              type="url"
              value={values.externalLink}
              onChange={(event) => update("externalLink", event.target.value)}
              placeholder="https://example.com/project"
            />
          </label>
        </div>

        {apiError ? <p className="form-error">{apiError}</p> : null}

        <button className="btn-primary" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Creating..." : "Create campaign"}
        </button>
      </form>
    </section>
  );
}
