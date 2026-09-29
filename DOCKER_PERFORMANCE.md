# Docker Image Performance Notes

## How to Reproduce the Benchmark

Run the docker benchmark script with:

```bash
./scripts/benchmark-docker.sh
```

This builds both the backend and frontend Docker images using the multi-stage build patterns defined in their respective `Dockerfile`s, and outputs their current sizes. This is the primary method for contributors to measure before/after changes to the Docker image sizes.

## Main Cost Drivers (Baseline)

### Backend
| Module / Step | Approx. Size | Cost Driver Reason |
|---|---|---|
| `node:22.14.0-alpine3.21` Base | ~140 MB | Node.js runtime and Alpine Linux base system. |
| `node_modules` | ~45 MB | Production dependencies (e.g., `@stellar/stellar-sdk`, `better-sqlite3` native binaries). |
| `dist/` | ~1 MB | Compiled TypeScript application code. |

### Frontend
| Module / Step | Approx. Size | Cost Driver Reason |
|---|---|---|
| `nginxinc/nginx-unprivileged:1.27-alpine` Base | ~45 MB | Nginx web server and Alpine Linux base system. |
| Static Assets | ~2 MB | Compiled Vite frontend bundle (`html/`). |

> Sizes are approximate. Run `./scripts/benchmark-docker.sh` for current figures.

## Recommended Limits

- **Backend Image**: We recommend keeping the total backend production image under **250 MB**. Use `npm ci --omit=dev` and clear caches (`npm cache clean --force`) to avoid including unnecessary development tools.
- **Frontend Image**: We recommend keeping the total frontend production image under **60 MB**. The frontend image only requires the Nginx base and static HTML/JS/CSS assets.

## Code-Splitting / Optimization Strategy

Both services use a multi-stage Docker build process:
- **Builder Stage**: Installs dependencies and builds the code (`npm run build`). The backend then prunes `devDependencies` in this already-installed tree so it can be reused by the runtime image without a second full dependency install.
- **Production Stage**: Starts from a fresh base image and copies only production dependencies and compiled artifacts from the builder. This excludes build tools and raw source code from the final image while avoiding repeated backend dependency installation.
