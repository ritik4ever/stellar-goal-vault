# Contributing to Stellar Goal Vault

First off, thank you for considering contributing to Stellar Goal Vault! It's people like you that make the open-source community such an amazing place to learn, inspire, and create.

Stellar Goal Vault is a lightweight crowdfunding MVP for the Stellar ecosystem, and we welcome contributions of all kinds: from bug fixes and documentation to new features and UI improvements.

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Local Development Setup](#local-development-setup)
3. [Testing](#testing)
4. [Contribution Workflow](#contribution-workflow)
5. [Style & Branch Naming](#style--branch-naming)
6. [Issue Labeling](#issue-labeling)
7. [Pull Request Expectations](#pull-request-expectations)

---

## Getting Started

1. **Fork the repository** on GitHub.
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/stellar-goal-vault.git
   cd stellar-goal-vault
   ```
3. **Set up the upstream remote** to stay synced with the main project:
   ```bash
   git remote add upstream https://github.com/SamixYasuke/stellar-goal-vault.git
   ```

### Prerequisites

- **Node.js 18+**
- **npm 9+**
- (Optional) **Rust & Soroban CLI** (if you're working on smart contracts)

---

## Local Development Setup

The project is split into three main parts: `frontend`, `backend`, and `contracts`.

### 1. Install All Dependencies

From the repository root, you can install dependencies for both the frontend and backend using:

```bash
npm run install:all
```

### 2. Backend Setup

The backend uses **Express** and **SQLite**.

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Create/copy a `.env` file (if needed, see `README.md` for defaults).
3. Run the development server:
   ```bash
   npm run dev
   ```
   The API will be available at `http://localhost:3001`.

### 3. Frontend Setup

The frontend is built with **React + Vite**.

1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```
2. Run the development server:
   ```bash
   npm run dev
   ```
   The dashboard will be available at `http://localhost:3000`.

---

## Testing

We use **Vitest** for testing both the frontend and backend.

- **Frontend tests:** Run `npm run test` inside the `/frontend` directory.
- **Backend tests:** Run `npm run test` inside the `/backend` directory.

Before submitting a PR, please ensure that all tests pass.

---

## Contribution Workflow

1. **Find an Issue:** Look for issues labeled `help wanted` or `good first issue`. If you have a new idea, please open an issue first to discuss it.
2. **Assign Yourself:** Comment on the issue to let others know you're working on it.
3. **Create a Branch:** (See [Style & Branch Naming](#style--branch-naming)).
4. **Implementation:** Write your code, following existing patterns and styles.
5. **Add Tests:** If you're adding a feature or fixing a bug, please include tests.
6. **Submit a PR:** Push your branch and open a Pull Request against the `main` branch.

---

## Style & Branch Naming

### Branch Naming Conventions

To keep the repository organized, please use the following prefixes for your branches:

- `feat/` — For new features (e.g., `feat/add-freighter-signing`)
- `fix/` — For bug fixes (e.g., `fix/sqlite-connection-leak`)
- `docs/` — For documentation changes (e.g., `docs/update-api-reference`)
- `refactor/` — For code cleanup or restructuring
- `test/` — For adding or improving tests

### Coding Standards

- Use **TypeScript** for both frontend and backend.
- Follow **standard Prettier/ESLint rules** (automated linting runs in CI).
- Keep components small and modular.

---

## Issue Labeling

We use labels to categorize issues and make it easier for contributors to find tasks:

- `good first issue` — Perfect for new contributors. Usually small, well-defined tasks.
- `help wanted` — Tasks we need help with but might be more complex.
- `bug` — Something isn't working as expected.
- `enhancement` — New features or improvements.
- `frontend` / `backend` / `soroban` — Indicates which part of the stack is involved.
- `ux` — Focuses on user interface and experience improvements.
- `indexer` — Related to the on-chain event indexing logic.

---

## Pull Request Expectations

When you open a PR, please fill out the provided template (if available) or ensure it includes:

- **What changed?** A clear summary of your work.
- **Why?** Link to the issue being addressed.
- **How was it tested?** Detail your manual and automated testing.
- **Screenshots?** Highly recommended for any frontend/UI changes.

---

## Thank You!

Your contributions make this project better for everyone in the Stellar ecosystem. If you have any questions, feel free to reach out via GitHub Issues.
