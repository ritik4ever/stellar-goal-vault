import { describe, expect, it } from "vitest";
import { createCampaignPayloadSchema } from "./schemas";

describe("createCampaignPayloadSchema - Input Sanitization", () => {
  const basePayload = {
    creator: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    acceptedTokens: ["USDC"],
    targetAmount: 100,
    deadline: Math.floor(Date.now() / 1000) + 3600,
  };

  it("should successfully validate and trim valid inputs", () => {
    const result = createCampaignPayloadSchema.safeParse({
      ...basePayload,
      title: "  Valid Campaign Title  ",
      description: "  This is a valid campaign description that meets the length requirements.  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe("Valid Campaign Title");
      expect(result.data.description).toBe("This is a valid campaign description that meets the length requirements.");
    }
  });

  it("should reject titles with only whitespace", () => {
    const result = createCampaignPayloadSchema.safeParse({
      ...basePayload,
      title: "     ",
      description: "This is a valid campaign description that meets the length requirements.",
    });
    expect(result.success).toBe(false);
  });

  it("should escape HTML tags in title and description during parsing", () => {
    const result = createCampaignPayloadSchema.safeParse({
      ...basePayload,
      title: "<h1>Test</h1>",
      description: "<h1>Test</h1> with at least 20 characters",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe("&lt;h1&gt;Test&lt;&sol;h1&gt;");
      expect(result.data.description).toBe("&lt;h1&gt;Test&lt;&sol;h1&gt; with at least 20 characters");
    }
  });

  it("should reject script tags in title", () => {
    const result = createCampaignPayloadSchema.safeParse({
      ...basePayload,
      title: "Campaign <script>alert(1)</script>",
      description: "This is a valid campaign description that meets the length requirements.",
    });
    expect(result.success).toBe(false);
  });

  it("should reject SQL comment sequences in title", () => {
    const result1 = createCampaignPayloadSchema.safeParse({
      ...basePayload,
      title: "Campaign -- SQL Injection",
      description: "This is a valid campaign description that meets the length requirements.",
    });
    expect(result1.success).toBe(false);

    const result2 = createCampaignPayloadSchema.safeParse({
      ...basePayload,
      title: "Campaign /* SQL Comment */",
      description: "This is a valid campaign description that meets the length requirements.",
    });
    expect(result2.success).toBe(false);
  });

  it("should reject SQL comment sequences in description", () => {
    const result = createCampaignPayloadSchema.safeParse({
      ...basePayload,
      title: "Valid Campaign",
      description: "This is a valid campaign description that meets the length requirements. -- SQL injection",
    });
    expect(result.success).toBe(false);
  });
});
