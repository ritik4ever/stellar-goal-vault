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
- **Builder Stage**: Installs all dependencies (including `devDependencies`), copies all source files, and builds the code (`npm run build`).
- **Production Stage**: Starts from a fresh base image, installs only production dependencies (`npm ci --omit=dev`), clears the npm cache, and copies over only the necessary compiled artifacts from the builder stage. This drastically reduces the final image size by excluding the build tools, raw source code, and development modules.

## Regression Coverage (CI)

`./scripts/docker-size-regression.sh` builds both production images and checks their size against the recorded baseline in `scripts/docker-size-baseline.json`:

```bash
./scripts/docker-size-regression.sh            # build both images and check
./scripts/docker-size-regression.sh --no-build # measure already-built images
```

- **Signal:** production image size in bytes. Image size is a stable signal, so the check never relies on flaky micro-timing assertions.
- **Baseline:** `scripts/docker-size-baseline.json` (`baselineBytes` per service).
- **Limits:** the recommended ceilings above are enforced as `maxBytes`; exceeding one fails the check.
- **Warning:** growth beyond `TOLERANCE_PCT` (default 10%) is reported without failing the run.

The `Docker Image Size Regression` GitHub Actions workflow runs this check on pull requests that touch a `Dockerfile` or `docker-compose*.yml` and publishes the size table to the job summary.
