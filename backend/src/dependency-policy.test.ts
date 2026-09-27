/**
 * Dependency Policy Security Regression Tests
 *
 * These tests guard the dependency-hygiene rules that are enforced across this
 * repository. They are written as static-analysis tests: they read
 * package.json / package-lock.json on disk and assert structural invariants,
 * so they run without network access and without installing any packages.
 *
 * Protected boundaries
 * ─────────────────────
 * 1. Lockfile integrity   — package-lock.json must exist and be lock-version 2+
 *                           (an absent or v1 lockfile lets npm install drift
 *                            off pinned versions, defeating `npm ci`)
 * 2. No wildcard versions — production dependencies must not use `*` or `""`
 *                           (defeats all version pinning)
 * 3. No `file:` overrides — local-path overrides in "overrides"/"resolutions"
 *                           silently replace published packages with local code
 * 4. Security-critical packages present — helmet, cors, express must be listed
 *                           (removing them disables the security middleware that
 *                            other tests, e.g. security.test.ts, depend on)
 * 5. Dependabot configured — .github/dependabot.yml must cover both npm
 *                           ecosystems (backend + frontend) so automated
 *                           vulnerability PRs keep arriving
 * 6. Audit step present in CI — ci.yml must run `npm audit` with a non-trivial
 *                           audit level so high/critical CVEs block merges
 * 7. Frontend lockfile present — same drift-prevention guarantee for frontend
 * 8. No `--legacy-peer-deps` or `--force` in install scripts — those flags
 *                           bypass peer-dependency conflict checks that often
 *                           signal incompatible security patches
 * 9. devDependencies not in production dep list — a package appearing in both
 *                           is a sign of a confused manifest
 * 10. package-lock.json lockfileVersion ≥ 2 — v1 does not record integrity
 *                           hashes for all transitive deps
 *
 * Failure signal
 * ──────────────
 * Any test below failing means a protected invariant was weakened. Examples:
 *   – Removing helmet from dependencies        → test 4 fails
 *   – Deleting package-lock.json              → test 1 fails
 *   – Adding `"express": "*"` to deps         → test 2 fails
 *   – Deleting the npm audit step from ci.yml → test 6 fails
 */

import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

// ── Path helpers ──────────────────────────────────────────────────────────────
// __dirname is backend/src; walk up two levels to reach the repo root.
const ROOT = path.resolve(__dirname, '..', '..');
const BACKEND = path.join(ROOT, 'backend');
const FRONTEND = path.join(ROOT, 'frontend');
const GITHUB = path.join(ROOT, '.github');

function readJson(filePath: string): unknown {
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

function readText(filePath: string): string {
  return fs.readFileSync(filePath, 'utf-8');
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Lockfile existence and version
// ─────────────────────────────────────────────────────────────────────────────
describe('Dependency policy — lockfile integrity', () => {
  it('backend package-lock.json exists', () => {
    const lockPath = path.join(BACKEND, 'package-lock.json');
    expect(fs.existsSync(lockPath), `Missing: ${lockPath}`).toBe(true);
  });

  it('backend package-lock.json is lockfileVersion 2 or higher', () => {
    const lock = readJson(path.join(BACKEND, 'package-lock.json')) as Record<string, unknown>;
    expect(typeof lock.lockfileVersion).toBe('number');
    expect(lock.lockfileVersion as number).toBeGreaterThanOrEqual(2);
  });

  it('frontend package-lock.json exists', () => {
    const lockPath = path.join(FRONTEND, 'package-lock.json');
    expect(fs.existsSync(lockPath), `Missing: ${lockPath}`).toBe(true);
  });

  it('frontend package-lock.json is lockfileVersion 2 or higher', () => {
    const lock = readJson(path.join(FRONTEND, 'package-lock.json')) as Record<string, unknown>;
    expect(typeof lock.lockfileVersion).toBe('number');
    expect(lock.lockfileVersion as number).toBeGreaterThanOrEqual(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. No wildcard or empty version specifiers in production dependencies
// ─────────────────────────────────────────────────────────────────────────────
describe('Dependency policy — no wildcard versions', () => {
  function findWildcardDeps(deps: Record<string, string>): string[] {
    return Object.entries(deps)
      .filter(([, version]) => version === '*' || version === '' || version === 'latest')
      .map(([name]) => name);
  }

  it('backend production dependencies have no wildcard version specifiers', () => {
    const pkg = readJson(path.join(BACKEND, 'package.json')) as Record<string, unknown>;
    const deps = (pkg.dependencies ?? {}) as Record<string, string>;
    const wildcards = findWildcardDeps(deps);
    expect(wildcards, `Wildcard versions found: ${wildcards.join(', ')}`).toHaveLength(0);
  });

  it('frontend production dependencies have no wildcard version specifiers', () => {
    const pkg = readJson(path.join(FRONTEND, 'package.json')) as Record<string, unknown>;
    const deps = (pkg.dependencies ?? {}) as Record<string, string>;
    const wildcards = findWildcardDeps(deps);
    expect(wildcards, `Wildcard versions found: ${wildcards.join(', ')}`).toHaveLength(0);
  });

  it('backend devDependencies have no wildcard version specifiers', () => {
    const pkg = readJson(path.join(BACKEND, 'package.json')) as Record<string, unknown>;
    const deps = (pkg.devDependencies ?? {}) as Record<string, string>;
    const wildcards = findWildcardDeps(deps);
    expect(wildcards, `Wildcard versions found: ${wildcards.join(', ')}`).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. No local file: path overrides
// ─────────────────────────────────────────────────────────────────────────────
describe('Dependency policy — no local file: overrides', () => {
  function findFileOverrides(obj: Record<string, string>): string[] {
    return Object.entries(obj)
      .filter(([, v]) => typeof v === 'string' && v.startsWith('file:'))
      .map(([k]) => k);
  }

  it('backend package.json has no file: overrides', () => {
    const pkg = readJson(path.join(BACKEND, 'package.json')) as Record<string, unknown>;
    const overrides = (pkg.overrides ?? {}) as Record<string, string>;
    const resolutions = (pkg.resolutions ?? {}) as Record<string, string>;
    const bad = [...findFileOverrides(overrides), ...findFileOverrides(resolutions)];
    expect(bad, `file: overrides found: ${bad.join(', ')}`).toHaveLength(0);
  });

  it('frontend package.json has no file: overrides', () => {
    const pkg = readJson(path.join(FRONTEND, 'package.json')) as Record<string, unknown>;
    const overrides = (pkg.overrides ?? {}) as Record<string, string>;
    const resolutions = (pkg.resolutions ?? {}) as Record<string, string>;
    const bad = [...findFileOverrides(overrides), ...findFileOverrides(resolutions)];
    expect(bad, `file: overrides found: ${bad.join(', ')}`).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Security-critical packages are present in backend dependencies
// ─────────────────────────────────────────────────────────────────────────────
describe('Dependency policy — security-critical packages present', () => {
  const REQUIRED_BACKEND_DEPS = [
    'helmet',    // HTTP security headers (tested by security.test.ts)
    'cors',      // CORS policy enforcement (tested by cors-security.test.ts)
    'express',   // The HTTP framework — removing it would collapse everything
    'zod',       // Input validation schema library used by validateBody middleware
  ];

  for (const pkg of REQUIRED_BACKEND_DEPS) {
    it(`backend lists "${pkg}" in production dependencies`, () => {
      const manifest = readJson(path.join(BACKEND, 'package.json')) as Record<string, unknown>;
      const deps = (manifest.dependencies ?? {}) as Record<string, string>;
      expect(
        deps[pkg],
        `"${pkg}" is missing from backend dependencies — security middleware depends on it`,
      ).toBeDefined();
    });
  }

  it('backend helmet version is at least 7 (major version with modern CSP defaults)', () => {
    const manifest = readJson(path.join(BACKEND, 'package.json')) as Record<string, unknown>;
    const deps = (manifest.dependencies ?? {}) as Record<string, string>;
    const helmetVersion = deps['helmet'] ?? '';
    // Strip leading range characters (^, ~, >=, etc.) to get the base semver
    const major = parseInt(helmetVersion.replace(/^[^0-9]*/, ''), 10);
    expect(
      major,
      `helmet version "${helmetVersion}" is below 7; upgrade to get modern CSP defaults`,
    ).toBeGreaterThanOrEqual(7);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Dependabot covers both npm ecosystems
// ─────────────────────────────────────────────────────────────────────────────
describe('Dependency policy — Dependabot configuration', () => {
  it('.github/dependabot.yml exists', () => {
    const depbotPath = path.join(GITHUB, 'dependabot.yml');
    expect(fs.existsSync(depbotPath), `Missing: ${depbotPath}`).toBe(true);
  });

  it('dependabot.yml covers the /backend npm ecosystem', () => {
    const raw = readText(path.join(GITHUB, 'dependabot.yml'));
    // Must have an npm entry pointing at /backend
    expect(raw).toMatch(/package-ecosystem:\s*["']?npm["']?/);
    expect(raw).toContain('/backend');
  });

  it('dependabot.yml covers the /frontend npm ecosystem', () => {
    const raw = readText(path.join(GITHUB, 'dependabot.yml'));
    expect(raw).toContain('/frontend');
  });

  it('dependabot.yml schedules weekly (or more frequent) updates', () => {
    const raw = readText(path.join(GITHUB, 'dependabot.yml'));
    // Accepted schedule intervals per GitHub docs: daily, weekly, monthly
    // monthly is too infrequent for a security-focused repo; require daily or weekly
    expect(raw).toMatch(/interval:\s*["']?(daily|weekly)["']?/);
  });

  it('dependabot.yml does not use an open-pull-requests-limit of 0 (would disable updates)', () => {
    const raw = readText(path.join(GITHUB, 'dependabot.yml'));
    // Ensure it's not set to 0 for both entries combined
    const zeroMatches = [...raw.matchAll(/open-pull-requests-limit:\s*0/g)];
    expect(
      zeroMatches.length,
      'open-pull-requests-limit: 0 disables Dependabot PRs entirely',
    ).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. CI audit step is present and enforced
// ─────────────────────────────────────────────────────────────────────────────
describe('Dependency policy — CI audit enforcement', () => {
  it('ci.yml exists', () => {
    const ciPath = path.join(GITHUB, 'workflows', 'ci.yml');
    expect(fs.existsSync(ciPath), `Missing: ${ciPath}`).toBe(true);
  });

  it('ci.yml runs npm audit', () => {
    const raw = readText(path.join(GITHUB, 'workflows', 'ci.yml'));
    expect(raw).toContain('npm audit');
  });

  it('ci.yml sets --audit-level to high or critical (not none or low)', () => {
    const raw = readText(path.join(GITHUB, 'workflows', 'ci.yml'));
    // Acceptable: --audit-level=high or --audit-level=critical
    // Unacceptable: --audit-level=none, --audit-level=low, --audit-level=moderate
    expect(raw).toMatch(/--audit-level[=\s]+(?:high|critical)/);
    expect(raw).not.toMatch(/--audit-level[=\s]+none/);
    expect(raw).not.toMatch(/--audit-level[=\s]+low/);
  });

  it('ci.yml npm audit step does not have continue-on-error: true', () => {
    const raw = readText(path.join(GITHUB, 'workflows', 'ci.yml'));
    // Split on the audit step and check the block immediately following
    const auditStepIdx = raw.indexOf('npm audit --audit-level');
    expect(auditStepIdx).toBeGreaterThan(-1);
    // The 300 chars after the audit command should not contain continue-on-error: true
    const auditContext = raw.slice(
      Math.max(0, auditStepIdx - 200),
      auditStepIdx + 300,
    );
    expect(auditContext).not.toContain('continue-on-error: true');
  });

  it('ci.yml uses npm ci (not npm install) to install deps — ensures lockfile is honoured', () => {
    const raw = readText(path.join(GITHUB, 'workflows', 'ci.yml'));
    expect(raw).toContain('npm ci');
    // `npm install` without args would ignore the lockfile on version drift
    // Allow `npm install` only for the root format-check step (it installs prettier)
    // The key backend build step must use `npm ci`
    const backendBuildSection = raw.slice(
      raw.indexOf('backend-build:'),
      raw.indexOf('frontend-build:'),
    );
    expect(backendBuildSection).toContain('npm ci');
    expect(backendBuildSection).not.toContain('npm install\n');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. No dangerous install flags in package.json scripts
// ─────────────────────────────────────────────────────────────────────────────
describe('Dependency policy — no dangerous install flags in scripts', () => {
  const DANGEROUS_FLAGS = ['--legacy-peer-deps', '--force', '--ignore-scripts=false'];

  function checkScripts(manifest: Record<string, unknown>, label: string): void {
    const scripts = (manifest.scripts ?? {}) as Record<string, string>;
    for (const flag of DANGEROUS_FLAGS) {
      for (const [scriptName, command] of Object.entries(scripts)) {
        expect(
          command,
          `${label} script "${scriptName}" contains dangerous flag "${flag}"`,
        ).not.toContain(flag);
      }
    }
  }

  it('backend package.json scripts do not use --legacy-peer-deps or --force', () => {
    const pkg = readJson(path.join(BACKEND, 'package.json')) as Record<string, unknown>;
    checkScripts(pkg, 'backend');
  });

  it('frontend package.json scripts do not use --legacy-peer-deps or --force', () => {
    const pkg = readJson(path.join(FRONTEND, 'package.json')) as Record<string, unknown>;
    checkScripts(pkg, 'frontend');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. devDependencies must not duplicate production dependencies
// ─────────────────────────────────────────────────────────────────────────────
describe('Dependency policy — no cross-listed packages', () => {
  function findDuplicates(
    deps: Record<string, string>,
    devDeps: Record<string, string>,
  ): string[] {
    return Object.keys(deps).filter((name) => name in devDeps);
  }

  it('backend has no package listed in both dependencies and devDependencies', () => {
    const pkg = readJson(path.join(BACKEND, 'package.json')) as Record<string, unknown>;
    const deps = (pkg.dependencies ?? {}) as Record<string, string>;
    const devDeps = (pkg.devDependencies ?? {}) as Record<string, string>;
    const dupes = findDuplicates(deps, devDeps);
    expect(
      dupes,
      `Packages in both deps and devDeps: ${dupes.join(', ')}`,
    ).toHaveLength(0);
  });

  it('frontend has no package listed in both dependencies and devDependencies', () => {
    const pkg = readJson(path.join(FRONTEND, 'package.json')) as Record<string, unknown>;
    const deps = (pkg.dependencies ?? {}) as Record<string, string>;
    const devDeps = (pkg.devDependencies ?? {}) as Record<string, string>;
    const dupes = findDuplicates(deps, devDeps);
    expect(
      dupes,
      `Packages in both deps and devDeps: ${dupes.join(', ')}`,
    ).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Negative bypass tests — these verify the tests above would catch regressions
// ─────────────────────────────────────────────────────────────────────────────
describe('Dependency policy — canary / self-verification', () => {
  it('wildcard version detector catches * specifier', () => {
    const fake = { 'some-pkg': '*' };
    const wildcards = Object.entries(fake)
      .filter(([, v]) => v === '*' || v === '' || v === 'latest')
      .map(([k]) => k);
    expect(wildcards).toContain('some-pkg');
  });

  it('wildcard version detector catches empty string specifier', () => {
    const fake = { 'some-pkg': '' };
    const wildcards = Object.entries(fake)
      .filter(([, v]) => v === '*' || v === '' || v === 'latest')
      .map(([k]) => k);
    expect(wildcards).toContain('some-pkg');
  });

  it('wildcard version detector catches "latest" specifier', () => {
    const fake = { 'some-pkg': 'latest' };
    const wildcards = Object.entries(fake)
      .filter(([, v]) => v === '*' || v === '' || v === 'latest')
      .map(([k]) => k);
    expect(wildcards).toContain('some-pkg');
  });

  it('file: override detector catches file: prefix', () => {
    const fake = { 'local-lib': 'file:../local-lib' };
    const bad = Object.entries(fake)
      .filter(([, v]) => typeof v === 'string' && v.startsWith('file:'))
      .map(([k]) => k);
    expect(bad).toContain('local-lib');
  });

  it('audit-level regex matches "high" and "critical" but not "none" or "low"', () => {
    const goodHigh = 'run: npm audit --audit-level=high';
    const goodCritical = 'run: npm audit --audit-level=critical';
    const badNone = 'run: npm audit --audit-level=none';
    const badLow = 'run: npm audit --audit-level=low';

    expect(goodHigh).toMatch(/--audit-level[=\s]+(?:high|critical)/);
    expect(goodCritical).toMatch(/--audit-level[=\s]+(?:high|critical)/);
    expect(badNone).not.toMatch(/--audit-level[=\s]+(?:high|critical)/);
    expect(badLow).not.toMatch(/--audit-level[=\s]+(?:high|critical)/);
  });
});
