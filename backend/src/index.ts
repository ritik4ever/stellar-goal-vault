import cors from "cors";
import "dotenv/config";
import express, { Request, Response } from "express";
import { z } from "zod";
import {
  addPledge,
  calculateProgress,
  claimCampaign,
  createCampaign,
  getCampaign,
  getCampaignWithProgress,
  initCampaignStore,
  listCampaigns,
  refundContributor,
} from "./services/campaignStore";
import { getCampaignHistory } from "./services/eventHistory";
import { fetchOpenIssues } from "./services/openIssues";
import {
  campaignIdSchema,
  claimCampaignPayloadSchema,
  createCampaignPayloadSchema,
  createPledgePayloadSchema,
  refundPayloadSchema,
  zodIssuesToErrorMessage,
  zodIssuesToValidationIssues,
} from "./validation/schemas";

export const app = express();
const port = Number(process.env.PORT ?? 3001);

app.use(cors());
app.use(express.json());

function sendValidationError(res: Response, issues: z.ZodIssue[]) {
  res.status(400).json({
    error: zodIssuesToErrorMessage(issues),
    details: zodIssuesToValidationIssues(issues),
  });
}

function parseCampaignId(campaignIdRaw: unknown):
  | { ok: true; value: string }
  | { ok: false; issues: z.ZodIssue[] } {
  if (typeof campaignIdRaw !== "string") {
    return {
      ok: false,
      issues: [
        {
          code: "custom",
          message: "Campaign ID must be a string.",
          path: ["id"],
        },
      ],
    };
  }

  const parsed = campaignIdSchema.safeParse(campaignIdRaw);
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues };
  }

  return { ok: true, value: parsed.data };
}

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({
    service: "stellar-goal-vault-backend",
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/campaigns", (_req: Request, res: Response) => {
  const data = listCampaigns().map((campaign) => ({
    ...campaign,
    progress: calculateProgress(campaign),
  }));

  res.json({ data });
});

app.get("/api/campaigns/:id", (req: Request, res: Response) => {
  const parsedId = parseCampaignId(req.params.id);
  if (!parsedId.ok) {
    sendValidationError(res, parsedId.issues);
    return;
  }

  const campaign = getCampaignWithProgress(parsedId.value);
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found." });
    return;
  }

  res.json({ data: campaign });
});

app.post("/api/campaigns", (req: Request, res: Response) => {
  const parsedBody = createCampaignPayloadSchema.safeParse(req.body);
  if (!parsedBody.success) {
    sendValidationError(res, parsedBody.error.issues);
    return;
  }

  if (parsedBody.data.deadline <= Math.floor(Date.now() / 1000)) {
    res.status(400).json({ error: "deadline must be in the future." });
    return;
  }

  const campaign = createCampaign(parsedBody.data);
  res.status(201).json({ data: { ...campaign, progress: calculateProgress(campaign) } });
});

app.post("/api/campaigns/:id/pledges", (req: Request, res: Response) => {
  const parsedId = parseCampaignId(req.params.id);
  if (!parsedId.ok) {
    sendValidationError(res, parsedId.issues);
    return;
  }

  const parsedBody = createPledgePayloadSchema.safeParse(req.body);
  if (!parsedBody.success) {
    sendValidationError(res, parsedBody.error.issues);
    return;
  }

  try {
    const campaign = addPledge(parsedId.value, parsedBody.data);
    res.status(201).json({ data: { ...campaign, progress: calculateProgress(campaign) } });
  } catch (error) {
    const serviceError = error as Error & { statusCode?: number };
    res.status(serviceError.statusCode ?? 500).json({
      error: serviceError.message || "Failed to add pledge.",
    });
  }
});

app.post("/api/campaigns/:id/claim", (req: Request, res: Response) => {
  const parsedId = parseCampaignId(req.params.id);
  if (!parsedId.ok) {
    sendValidationError(res, parsedId.issues);
    return;
  }

  const parsedBody = claimCampaignPayloadSchema.safeParse(req.body);
  if (!parsedBody.success) {
    sendValidationError(res, parsedBody.error.issues);
    return;
  }

  try {
    const campaign = claimCampaign(parsedId.value, parsedBody.data.creator);
    res.json({ data: { ...campaign, progress: calculateProgress(campaign) } });
  } catch (error) {
    const serviceError = error as Error & { statusCode?: number };
    res.status(serviceError.statusCode ?? 500).json({
      error: serviceError.message || "Failed to claim campaign.",
    });
  }
});

app.post("/api/campaigns/:id/refund", (req: Request, res: Response) => {
  const parsedId = parseCampaignId(req.params.id);
  if (!parsedId.ok) {
    sendValidationError(res, parsedId.issues);
    return;
  }

  const parsedBody = refundPayloadSchema.safeParse(req.body);
  if (!parsedBody.success) {
    sendValidationError(res, parsedBody.error.issues);
    return;
  }

  try {
    const result = refundContributor(parsedId.value, parsedBody.data.contributor);
    res.json({
      data: {
        ...result.campaign,
        progress: calculateProgress(result.campaign),
        refundedAmount: result.refundedAmount,
      },
    });
  } catch (error) {
    const serviceError = error as Error & { statusCode?: number };
    res.status(serviceError.statusCode ?? 500).json({
      error: serviceError.message || "Failed to refund contributor.",
    });
  }
});

app.get("/api/campaigns/:id/history", (req: Request, res: Response) => {
  const parsedId = parseCampaignId(req.params.id);
  if (!parsedId.ok) {
    sendValidationError(res, parsedId.issues);
    return;
  }

  const campaign = getCampaign(parsedId.value);
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found." });
    return;
  }

  res.json({ data: getCampaignHistory(parsedId.value) });
});

app.get("/api/open-issues", async (_req: Request, res: Response) => {
  const data = await fetchOpenIssues();
  res.json({ data });
});

app.get("/api/config", (_req: Request, res: Response) => {
  res.json({
    data: {
      allowedAssets: config.allowedAssets,
    },
  });
});

function startServer() {
  initCampaignStore();
  app.listen(port, () => {
    console.log(`Stellar Goal Vault API listening on http://localhost:${port}`);
  });
}

if (require.main === module) {
  startServer();
}
