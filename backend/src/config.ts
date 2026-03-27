import "dotenv/config";

const parseOrigins = (originsStr: string): string[] => {
  return originsStr
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
};

export const config = {
  port: Number(process.env.PORT ?? 3001),
  allowedAssets: (process.env.ALLOWED_ASSETS ?? "USDC,XLM")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean),
  corsAllowedOrigins: parseOrigins(
    process.env.CORS_ALLOWED_ORIGINS ?? "http://localhost:5173"
  ),
};
