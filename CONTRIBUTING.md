# Contributing

Thank you for your interest in contributing to **Stellar Goal Vault**!

## Quick start

1. **Fork** the repository on GitHub.
2. **Clone** your fork: `git clone https://github.com/YOUR_USERNAME/stellar-goal-vault.git`
3. **Install dependencies:** `npm run install:all`
4. **Create a branch:** `git checkout -b feature/my-feature`
5. Make your changes and test them.
6. **Commit** using conventional commits (e.g., `feat: add new endpoint`).
7. **Push** and open a **Pull Request** against the `main` branch.

## Before you start

- Read the [README.md](./README.md) for project overview and architecture.
- Check the [FAQ.md](./FAQ.md) for answers to common questions.
- Browse `OPEN_SOURCE_ISSUES.md` for curated contribution ideas.

## Testing

- Backend: `cd backend && npx vitest`
- Contract: `cd contracts && cargo test`
- E2E: `npm run test:e2e`

## Code style

- TypeScript: ESLint + Prettier (pre-commit via Husky + lint-staged)
- Rust: `cargo fmt`

## Questions?

Check the [FAQ.md](./FAQ.md) before opening an issue. If your question isn't covered there, feel free to open a GitHub Discussion.