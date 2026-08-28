# Lighthouse CI

This document describes how Lighthouse CI is configured to enforce frontend performance budgets.

## Configuration

The `lighthouserc.json` file at the project root defines:
- Performance threshold: ≥ 80
- Accessibility threshold: ≥ 90
- Best Practices threshold: ≥ 90
- SEO threshold: ≥ 80 (warning only)
- 3 runs per URL for statistical accuracy
- Desktop preset for consistent measurements

## GitHub Actions Setup

To enable Lighthouse CI in PRs, add a workflow file at `.github/workflows/lighthouse.yml`:

```yaml
name: Lighthouse CI
on: [pull_request]
jobs:
  lighthouse:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm install -g @lhci/cli serve
      - run: cd frontend && npm ci && npm run build
      - run: lhci autorun
```

## Running Locally

```bash
# Build the frontend
cd frontend && npm run build

# Run Lighthouse CI locally
npx lhci autorun --collect.staticDistDir=./frontend/dist
```

## Thresholds

| Category | Threshold | Behavior |
|----------|-----------|----------|
| Performance | ≥ 80 | Blocks PR |
| Accessibility | ≥ 90 | Blocks PR |
| Best Practices | ≥ 90 | Blocks PR |
| SEO | ≥ 80 | Warning only |

## Budget Tracking

Lighthouse reports are uploaded to temporary public storage and linked in PR comments for review.
