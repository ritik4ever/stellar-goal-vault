# Secret Management

## GitHub Actions Secrets

All secrets are stored in GitHub Actions encrypted secrets. Never hardcode secrets in source code.

### Required Secrets

| Secret Name | Description |
|-------------|-------------|
| `STELLAR_SECRET_KEY` | Backend Stellar account secret key |
| `HORIZON_URL` | Horizon RPC endpoint URL |
| `SOROBAN_RPC_URL` | Soroban RPC endpoint URL |
| `WEBHOOK_SECRET` | Webhook signing secret |
| `DATABASE_URL` | Database connection string |

### Setting Secrets

```bash
gh secret set STELLAR_SECRET_KEY --repo ritik4ever/stellar-goal-vault
```

### Rotation Policy

- Rotate secrets every 90 days
- Rotate immediately if compromised
- Use different secrets per environment
