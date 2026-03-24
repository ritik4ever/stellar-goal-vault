import "dotenv/config";

export const config = {
  port: Number(process.env.PORT ?? 3001),
  allowedAssets: (process.env.ALLOWED_ASSETS ?? "USDC,XLM")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean),
};
