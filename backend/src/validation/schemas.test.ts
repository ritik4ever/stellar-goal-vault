import { describe, it, expect } from "vitest";
import { createCampaignPayloadSchema } from "./schemas";

const VALID_CREATOR = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

const validCampaignBase = {
  creator: VALID_CREATOR,
  title: "Help us build Stellar dApps",
  description: "A campaign to fund development of decentralized applications on Stellar.",
  acceptedTokens: ["USDC"],
  targetAmount: 1000,
  deadline: Math.floor(Date.now() / 1000) + 86400,
};

describe("createCampaignPayloadSchema — SSRF protection (#308)", () => {
  it("accepts valid https:// imageUrl", () => {
    const result = createCampaignPayloadSchema.safeParse({
      ...validCampaignBase,
      metadata: { imageUrl: "https://example.com/image.png" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts valid https:// externalLink", () => {
    const result = createCampaignPayloadSchema.safeParse({
      ...validCampaignBase,
      metadata: { externalLink: "https://example.com/campaign" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects http:// imageUrl (SSRF protection)", () => {
    const result = createCampaignPayloadSchema.safeParse({
      ...validCampaignBase,
      metadata: { imageUrl: "http://example.com/image.png" },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message.toLowerCase()).toContain("https");
    }
  });

  it("rejects http:// externalLink (SSRF protection)", () => {
    const result = createCampaignPayloadSchema.safeParse({
      ...validCampaignBase,
      metadata: { externalLink: "http://example.com/campaign" },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message.toLowerCase()).toContain("https");
    }
  });

  it("rejects file:// protocol in imageUrl", () => {
    const result = createCampaignPayloadSchema.safeParse({
      ...validCampaignBase,
      metadata: { imageUrl: "file:///etc/passwd" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects data: URI in imageUrl", () => {
    const result = createCampaignPayloadSchema.safeParse({
      ...validCampaignBase,
      metadata: { imageUrl: "data:image/png;base64,iVBORw0KGgo=" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects javascript: URI in externalLink", () => {
    const result = createCampaignPayloadSchema.safeParse({
      ...validCampaignBase,
      metadata: { externalLink: "javascript:alert(1)" },
    });
    expect(result.success).toBe(false);
  });

  it("allows metadata to be optional", () => {
    const result = createCampaignPayloadSchema.safeParse(validCampaignBase);
    expect(result.success).toBe(true);
  });

  it("allows metadata with empty object", () => {
    const result = createCampaignPayloadSchema.safeParse({
      ...validCampaignBase,
      metadata: {},
    });
    expect(result.success).toBe(true);
  });

  it("allows imageUrl without externalLink", () => {
    const result = createCampaignPayloadSchema.safeParse({
      ...validCampaignBase,
      metadata: { imageUrl: "https://example.com/image.png" },
    });
    expect(result.success).toBe(true);
  });

  it("allows externalLink without imageUrl", () => {
    const result = createCampaignPayloadSchema.safeParse({
      ...validCampaignBase,
      metadata: { externalLink: "https://example.com/campaign" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid URL format (not a URL at all)", () => {
    const result = createCampaignPayloadSchema.safeParse({
      ...validCampaignBase,
      metadata: { imageUrl: "not-a-url" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects ftp:// protocol in imageUrl", () => {
    const result = createCampaignPayloadSchema.safeParse({
      ...validCampaignBase,
      metadata: { imageUrl: "ftp://files.example.com/image.png" },
    });
    expect(result.success).toBe(false);
  });
});
