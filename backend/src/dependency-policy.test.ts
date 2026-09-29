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

  it('ci.yml sets --audit-level to high or critical (not none or low) on the blocking audit step', () => {
    const raw = readText(path.join(GITHUB, 'workflows', 'ci.yml'));
    // Acceptable: --audit-level=high or --audit-level=critical
    // Note: --audit-level=none is used in the non-blocking upload-report step to capture
    // all findings as a JSON artifact — that is intentional and does not weaken enforcement.
    // This test checks the *blocking* dedicated audit step specifically.
    expect(raw).toMatch(/--audit-level[=\s]+(?:high|critical)/);
    // The upload/report step using =none is acceptable; what must NOT exist is a weakening
    // of the blocking step itself — asserted in the step-scoped test in group 13.
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

// ─────────────────────────────────────────────────────────────────────────────
// 10. No VCS-protocol version specifiers
//
//     Specifiers like "git+https://...", "github:owner/repo", or
//     "bitbucket:owner/repo" bypass the npm registry entirely, meaning:
//       • The package is not scanned by `npm audit`
//       • No integrity hash is stored in the lockfile
//       • Supply-chain attacks are trivially possible via force-pushing the
//         referenced commit
//     These must never appear in production or dev dependencies.
// ─────────────────────────────────────────────────────────────────────────────
describe('Dependency policy — no VCS protocol specifiers', () => {
  // Prefixes that indicate a VCS source rather than the npm registry.
  const VCS_PREFIXES = [
    'git+',        // git+https:// or git+ssh://
    'git://',      // bare git protocol
    'github:',     // github:owner/repo shorthand
    'bitbucket:',  // bitbucket:owner/repo shorthand
    'gitlab:',     // gitlab:owner/repo shorthand
  ];

  function findVcsDeps(deps: Record<string, string>): string[] {
    return Object.entries(deps)
      .filter(([, version]) =>
        VCS_PREFIXES.some((prefix) => String(version).startsWith(prefix)),
      )
      .map(([name]) => name);
  }

  it('backend production dependencies have no VCS protocol specifiers', () => {
    const pkg = readJson(path.join(BACKEND, 'package.json')) as Record<string, unknown>;
    const deps = (pkg.dependencies ?? {}) as Record<string, string>;
    const vcs = findVcsDeps(deps);
    expect(vcs, `VCS-sourced deps found (bypass npm audit): ${vcs.join(', ')}`).toHaveLength(0);
  });

  it('backend devDependencies have no VCS protocol specifiers', () => {
    const pkg = readJson(path.join(BACKEND, 'package.json')) as Record<string, unknown>;
    const deps = (pkg.devDependencies ?? {}) as Record<string, string>;
    const vcs = findVcsDeps(deps);
    expect(vcs, `VCS-sourced devDeps found: ${vcs.join(', ')}`).toHaveLength(0);
  });

  it('frontend production dependencies have no VCS protocol specifiers', () => {
    const pkg = readJson(path.join(FRONTEND, 'package.json')) as Record<string, unknown>;
    const deps = (pkg.dependencies ?? {}) as Record<string, string>;
    const vcs = findVcsDeps(deps);
    expect(vcs, `VCS-sourced deps found: ${vcs.join(', ')}`).toHaveLength(0);
  });

  it('frontend devDependencies have no VCS protocol specifiers', () => {
    const pkg = readJson(path.join(FRONTEND, 'package.json')) as Record<string, unknown>;
    const deps = (pkg.devDependencies ?? {}) as Record<string, string>;
    const vcs = findVcsDeps(deps);
    expect(vcs, `VCS-sourced devDeps found: ${vcs.join(', ')}`).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. No open-ended / unbounded range specifiers
//
//     Specifiers like ">=0", ">0", ">=0.0.0", or "x.x.x" are semantically
//     equivalent to "*" — they allow any published version including malicious
//     ones — but they pass the exact-equality wildcard detector in group 2.
//     This group adds a structural check for these bypass forms.
// ─────────────────────────────────────────────────────────────────────────────
describe('Dependency policy — no open-ended range specifiers', () => {
  // Matches specifiers that permit any version: >=0, >=0.0.0, >0, x, x.x, x.x.x
  // These are distinct from normal ranges like ^1.0.0 or ~2.3.0 which are bounded.
  const OPEN_RANGE_RE = /^(>=?\s*0|x(\.x)?(\.x)?|[*].*)/i;

  function findOpenRangeDeps(deps: Record<string, string>): string[] {
    return Object.entries(deps)
      .filter(([, version]) => OPEN_RANGE_RE.test(String(version).trim()))
      .map(([name]) => name);
  }

  it('backend production dependencies have no open-ended range specifiers', () => {
    const pkg = readJson(path.join(BACKEND, 'package.json')) as Record<string, unknown>;
    const deps = (pkg.dependencies ?? {}) as Record<string, string>;
    const open = findOpenRangeDeps(deps);
    expect(open, `Open-ended ranges (bypass pinning): ${open.join(', ')}`).toHaveLength(0);
  });

  it('backend devDependencies have no open-ended range specifiers', () => {
    const pkg = readJson(path.join(BACKEND, 'package.json')) as Record<string, unknown>;
    const deps = (pkg.devDependencies ?? {}) as Record<string, string>;
    const open = findOpenRangeDeps(deps);
    expect(open, `Open-ended devDep ranges: ${open.join(', ')}`).toHaveLength(0);
  });

  it('frontend production dependencies have no open-ended range specifiers', () => {
    const pkg = readJson(path.join(FRONTEND, 'package.json')) as Record<string, unknown>;
    const deps = (pkg.dependencies ?? {}) as Record<string, string>;
    const open = findOpenRangeDeps(deps);
    expect(open, `Open-ended ranges: ${open.join(', ')}`).toHaveLength(0);
  });

  it('frontend devDependencies have no open-ended range specifiers', () => {
    const pkg = readJson(path.join(FRONTEND, 'package.json')) as Record<string, unknown>;
    const deps = (pkg.devDependencies ?? {}) as Record<string, string>;
    const open = findOpenRangeDeps(deps);
    expect(open, `Open-ended devDep ranges: ${open.join(', ')}`).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. Frontend devDependencies wildcard check
//
//     Group 2 checks backend devDeps and both manifests' production deps, but
//     the frontend devDeps were not covered. A "latest" or "*" in a frontend
//     build tool (e.g. vite, typescript, eslint) can pull a malicious release
//     into the build pipeline.
// ─────────────────────────────────────────────────────────────────────────────
describe('Dependency policy — frontend devDependencies no wildcard versions', () => {
  it('frontend devDependencies have no wildcard version specifiers', () => {
    const pkg = readJson(path.join(FRONTEND, 'package.json')) as Record<string, unknown>;
    const deps = (pkg.devDependencies ?? {}) as Record<string, string>;
    const wildcards = Object.entries(deps)
      .filter(([, version]) => version === '*' || version === '' || version === 'latest')
      .map(([name]) => name);
    expect(
      wildcards,
      `Frontend devDep wildcard versions found: ${wildcards.join(', ')}`,
    ).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. CI audit level must not be weakened to "moderate"
//
//     The existing group 6 tests reject "none" and "low" explicitly, but does
//     not cover "moderate" — a downgrade from "high" to "moderate" would let
//     known high-severity CVEs through without failing CI.
//
//     These tests assert that ci.yml does not use --audit-level=moderate and
//     that the dedicated audit step still uses "high" or "critical".
// ─────────────────────────────────────────────────────────────────────────────
describe('Dependency policy — CI audit level cannot be weakened to moderate', () => {
  it('ci.yml does not use --audit-level=moderate anywhere', () => {
    const raw = readText(path.join(GITHUB, 'workflows', 'ci.yml'));
    // "moderate" passes the existing positive regex but allows high-severity CVEs through
    expect(raw).not.toMatch(/--audit-level[=\s]+moderate/);
  });

  it('the dedicated "Audit backend dependencies" step still uses high or critical', () => {
    const raw = readText(path.join(GITHUB, 'workflows', 'ci.yml'));
    // Extract the block for the dedicated audit step (not the supply-chain step)
    const stepStart = raw.indexOf('Audit backend dependencies');
    expect(stepStart, '"Audit backend dependencies" step not found in ci.yml').toBeGreaterThan(-1);
    const stepBlock = raw.slice(stepStart, stepStart + 300);
    expect(stepBlock).toMatch(/--audit-level[=\s]+(?:high|critical)/);
    expect(stepBlock).not.toMatch(/--audit-level[=\s]+(?:none|low|moderate)/);
  });

  it('ci.yml frontend supply-chain check uses high or critical audit level (never moderate)', () => {
    const raw = readText(path.join(GITHUB, 'workflows', 'ci.yml'));
    // The frontend supply-chain step (conditional on push) must use a strong audit level.
    // NOTE: unlike backend, frontend has no always-running dedicated audit step — if one is
    // ever added it must also use high/critical, which this assertion would still enforce.
    const frontendSection = raw.slice(raw.indexOf('frontend-build:'));
    expect(frontendSection).toMatch(/npm audit --audit-level[=\s]+(?:high|critical)/);
    expect(frontendSection).not.toMatch(/--audit-level[=\s]+moderate/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 14. CI dedicated audit step must not be gated by a conditional
//
//     The "Check for supply-chain attacks" step in ci.yml runs only on `push`
//     or manual trigger — which is acceptable for the heavier checks. But the
//     dedicated "Audit backend dependencies" step must run unconditionally on
//     every event (including PRs) so that vulnerability CVEs block merges.
//
//     An `if:` condition added directly above or below `continue-on-error: false`
//     in that step would silently skip audit on PRs.
// ─────────────────────────────────────────────────────────────────────────────
describe('Dependency policy — dedicated audit step runs unconditionally', () => {
  it('the "Audit backend dependencies" step block does not contain an if: condition', () => {
    const raw = readText(path.join(GITHUB, 'workflows', 'ci.yml'));
    const stepStart = raw.indexOf('Audit backend dependencies');
    expect(stepStart).toBeGreaterThan(-1);

    // Extract the YAML block for this step — runs until the next `- name:` marker
    const afterStep = raw.slice(stepStart);
    const nextStepIdx = afterStep.indexOf('- name:', 1);
    const stepBlock = nextStepIdx > -1 ? afterStep.slice(0, nextStepIdx) : afterStep.slice(0, 500);

    // The step block must not contain an `if:` key — that would make it conditional
    expect(stepBlock).not.toMatch(/^\s*if:/m);
  });

  it('the "Audit backend dependencies" step has continue-on-error: false (or absent)', () => {
    const raw = readText(path.join(GITHUB, 'workflows', 'ci.yml'));
    const stepStart = raw.indexOf('Audit backend dependencies');
    const afterStep = raw.slice(stepStart);
    const nextStepIdx = afterStep.indexOf('- name:', 1);
    const stepBlock = nextStepIdx > -1 ? afterStep.slice(0, nextStepIdx) : afterStep.slice(0, 500);

    // Must not be set to true — either absent (defaults false) or explicitly false
    expect(stepBlock).not.toContain('continue-on-error: true');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 15. SRI script (scripts/check-sri.sh) correctness
//
//     check-sri.sh guards Subresource Integrity enforcement on CDN assets.
//     The script has had two known typos that would silently disable its check:
//       • `$HTTL_FILE` instead of `$HTML_FILE` — the while loop reads from an
//         undefined variable, so the loop body never executes and all CDN tags
//         pass without inspection
//       • `openssl dgest` instead of `openssl dgst` — the help message is wrong
//         but more importantly signals the file was not reviewed carefully
//     These tests act as a canary: if either typo is re-introduced the SRI
//     protection silently disappears.
// ─────────────────────────────────────────────────────────────────────────────
describe('Dependency policy — SRI script correctness', () => {
  const SRI_SCRIPT = path.join(ROOT, 'scripts', 'check-sri.sh');

  it('scripts/check-sri.sh exists', () => {
    expect(fs.existsSync(SRI_SCRIPT), `Missing: ${SRI_SCRIPT}`).toBe(true);
  });

  it('check-sri.sh reads from $HTML_FILE (not a misspelled variable)', () => {
    const src = readText(SRI_SCRIPT);
    // The while-read loop must consume $HTML_FILE — not $HTTL_FILE or any other typo
    expect(src).toContain('done < "$HTML_FILE"');
    expect(src).not.toContain('HTTL_FILE');
  });

  it('check-sri.sh uses correct openssl dgst command (not a typo)', () => {
    const src = readText(SRI_SCRIPT);
    // The help text must reference the correct subcommand
    expect(src).toContain('openssl dgst');
    expect(src).not.toContain('openssl dgest');
  });

  it('check-sri.sh defines HTML_FILE before use', () => {
    const src = readText(SRI_SCRIPT);
    // The script must assign HTML_FILE so the variable is never empty/undefined
    expect(src).toMatch(/HTML_FILE=/);
  });

  it('check-sri.sh exits non-zero on errors (set -e or explicit exit 1)', () => {
    const src = readText(SRI_SCRIPT);
    // set -euo pipefail is the correct guard; if removed the script silently succeeds
    expect(src).toContain('set -euo pipefail');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 16. No npm: protocol alias overrides
//
//     The `npm:` alias protocol in overrides/resolutions redirects a package
//     reference to a *different* published package name. This is a supply-chain
//     attack vector: `"express": "npm:evil-express@1.0.0"` silently replaces
//     the real express with a malicious package that passes `npm audit` under
//     the alias name.
//
//     The existing file: check in group 3 does not cover this case.
// ─────────────────────────────────────────────────────────────────────────────
describe('Dependency policy — no npm: protocol alias overrides', () => {
  function findNpmAliasOverrides(obj: Record<string, unknown>): string[] {
    return Object.entries(obj)
      .filter(([, v]) => typeof v === 'string' && (v as string).startsWith('npm:'))
      .map(([k]) => k);
  }

  it('backend package.json overrides have no npm: alias redirects', () => {
    const pkg = readJson(path.join(BACKEND, 'package.json')) as Record<string, unknown>;
    const overrides = (pkg.overrides ?? {}) as Record<string, unknown>;
    const resolutions = (pkg.resolutions ?? {}) as Record<string, unknown>;
    const bad = [...findNpmAliasOverrides(overrides), ...findNpmAliasOverrides(resolutions)];
    expect(bad, `npm: alias overrides found (supply-chain risk): ${bad.join(', ')}`).toHaveLength(0);
  });

  it('frontend package.json overrides have no npm: alias redirects', () => {
    const pkg = readJson(path.join(FRONTEND, 'package.json')) as Record<string, unknown>;
    const overrides = (pkg.overrides ?? {}) as Record<string, unknown>;
    const resolutions = (pkg.resolutions ?? {}) as Record<string, unknown>;
    const bad = [...findNpmAliasOverrides(overrides), ...findNpmAliasOverrides(resolutions)];
    expect(bad, `npm: alias overrides found: ${bad.join(', ')}`).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 17. Lockfile integrity hash presence
//
//     lockfileVersion >= 2 is a prerequisite for integrity hashes, but it does
//     not guarantee they are present — a hand-edited or partially regenerated
//     lockfile could have version=2 but missing `integrity` fields on some
//     entries. Without integrity hashes, `npm ci` cannot verify package
//     authenticity against the registry.
//
//     These tests spot-check that at least one production-dependency entry in
//     each lockfile carries an `integrity` hash. A full scan of all entries
//     would be prohibitively slow; the point is to catch a lockfile that was
//     regenerated without integrity (e.g. via an old npm version or flag).
// ─────────────────────────────────────────────────────────────────────────────
describe('Dependency policy — lockfile integrity hash presence', () => {
  it('backend package-lock.json has at least one package entry with an integrity hash', () => {
    const lock = readJson(path.join(BACKEND, 'package-lock.json')) as Record<string, unknown>;
    // lockfileVersion 2+ stores resolved packages under the `packages` key
    const packages = (lock.packages ?? {}) as Record<string, Record<string, unknown>>;
    const entries = Object.entries(packages);
    expect(entries.length, 'packages map is empty — lockfile may be malformed').toBeGreaterThan(0);

    // Find at least one non-root entry (the root entry "" has no integrity) with an integrity field
    const withIntegrity = entries.filter(
      ([key, meta]) => key !== '' && typeof meta === 'object' && 'integrity' in meta,
    );
    expect(
      withIntegrity.length,
      'No package entries with integrity hashes found — lockfile may be v1 format or hand-edited',
    ).toBeGreaterThan(0);
  });

  it('frontend package-lock.json has at least one package entry with an integrity hash', () => {
    const lock = readJson(path.join(FRONTEND, 'package-lock.json')) as Record<string, unknown>;
    const packages = (lock.packages ?? {}) as Record<string, Record<string, unknown>>;
    const entries = Object.entries(packages);
    expect(entries.length, 'packages map is empty — lockfile may be malformed').toBeGreaterThan(0);

    const withIntegrity = entries.filter(
      ([key, meta]) => key !== '' && typeof meta === 'object' && 'integrity' in meta,
    );
    expect(
      withIntegrity.length,
      'No package entries with integrity hashes found',
    ).toBeGreaterThan(0);
  });

  it('backend lockfile integrity hashes use sha512 (strongest algorithm)', () => {
    const lock = readJson(path.join(BACKEND, 'package-lock.json')) as Record<string, unknown>;
    const packages = (lock.packages ?? {}) as Record<string, Record<string, unknown>>;
    // Collect all integrity values and verify at least one is sha512
    const integrityValues = Object.entries(packages)
      .filter(([key]) => key !== '')
      .map(([, meta]) => (meta as Record<string, string>).integrity)
      .filter(Boolean);

    const sha512Count = integrityValues.filter((v) => String(v).startsWith('sha512-')).length;
    expect(
      sha512Count,
      'No sha512 integrity hashes found — lockfile may have been generated with a weak algorithm',
    ).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 18. Expanded canary / self-verification tests
//
//     These extend group 9 to cover the new detectors added above. Each test
//     unit-tests only the detection logic itself (no file I/O) to prove the
//     detector would catch a real regression if introduced.
// ─────────────────────────────────────────────────────────────────────────────
describe('Dependency policy — expanded canary / self-verification', () => {
  // ── VCS protocol detector ──────────────────────────────────────────────────
  const VCS_PREFIXES = ['git+', 'git://', 'github:', 'bitbucket:', 'gitlab:'];

  function detectVcs(deps: Record<string, string>): string[] {
    return Object.entries(deps)
      .filter(([, v]) => VCS_PREFIXES.some((p) => String(v).startsWith(p)))
      .map(([k]) => k);
  }

  it('VCS detector catches git+https:// specifier', () => {
    expect(detectVcs({ pkg: 'git+https://github.com/org/repo' })).toContain('pkg');
  });

  it('VCS detector catches github: shorthand specifier', () => {
    expect(detectVcs({ pkg: 'github:owner/repo' })).toContain('pkg');
  });

  it('VCS detector catches bitbucket: specifier', () => {
    expect(detectVcs({ pkg: 'bitbucket:owner/repo#abc123' })).toContain('pkg');
  });

  it('VCS detector does not flag normal semver ranges', () => {
    expect(detectVcs({ pkg: '^1.2.3' })).toHaveLength(0);
    expect(detectVcs({ pkg: '~4.0.0' })).toHaveLength(0);
    expect(detectVcs({ pkg: '>=2.0.0 <3.0.0' })).toHaveLength(0);
  });

  // ── Open-ended range detector ──────────────────────────────────────────────
  const OPEN_RANGE_RE = /^(>=?\s*0|x(\.x)?(\.x)?|[*].*)/i;

  function detectOpenRange(deps: Record<string, string>): string[] {
    return Object.entries(deps)
      .filter(([, v]) => OPEN_RANGE_RE.test(String(v).trim()))
      .map(([k]) => k);
  }

  it('open-ended range detector catches >=0', () => {
    expect(detectOpenRange({ pkg: '>=0' })).toContain('pkg');
  });

  it('open-ended range detector catches >=0.0.0', () => {
    expect(detectOpenRange({ pkg: '>=0.0.0' })).toContain('pkg');
  });

  it('open-ended range detector catches >0', () => {
    expect(detectOpenRange({ pkg: '>0' })).toContain('pkg');
  });

  it('open-ended range detector catches x.x.x', () => {
    expect(detectOpenRange({ pkg: 'x.x.x' })).toContain('pkg');
  });

  it('open-ended range detector does not flag bounded ranges like ^1.0.0', () => {
    expect(detectOpenRange({ pkg: '^1.0.0' })).toHaveLength(0);
    expect(detectOpenRange({ pkg: '~3.2.1' })).toHaveLength(0);
    expect(detectOpenRange({ pkg: '1.2.3' })).toHaveLength(0);
    expect(detectOpenRange({ pkg: '>=1.0.0 <2.0.0' })).toHaveLength(0);
  });

  // ── npm: alias override detector ───────────────────────────────────────────
  function detectNpmAlias(obj: Record<string, unknown>): string[] {
    return Object.entries(obj)
      .filter(([, v]) => typeof v === 'string' && (v as string).startsWith('npm:'))
      .map(([k]) => k);
  }

  it('npm: alias detector catches npm:evil-pkg@1.0.0 override', () => {
    expect(detectNpmAlias({ express: 'npm:evil-express@1.0.0' })).toContain('express');
  });

  it('npm: alias detector does not flag normal semver overrides', () => {
    expect(detectNpmAlias({ express: '^4.18.0' })).toHaveLength(0);
  });

  // ── audit-level "moderate" bypass ─────────────────────────────────────────
  it('audit-level regex does not match "moderate" as an acceptable level', () => {
    const moderateCommand = 'run: npm audit --audit-level=moderate';
    // Must NOT match the "acceptable" pattern — moderate is not high or critical
    expect(moderateCommand).not.toMatch(/--audit-level[=\s]+(?:high|critical)/);
  });

  it('audit-level moderate bypass would be caught by a negative assertion', () => {
    const moderateCommand = 'run: npm audit --audit-level=moderate';
    // Demonstrates that a test using .not.toMatch(/moderate/) would catch this
    const wouldBeDetected = /--audit-level[=\s]+moderate/.test(moderateCommand);
    expect(wouldBeDetected).toBe(true);
  });

  // ── SRI variable name detector ────────────────────────────────────────────
  it('SRI script variable-name detector catches $HTTL_FILE typo', () => {
    const buggyLine = 'done < "$HTTL_FILE"';
    expect(buggyLine).toContain('HTTL_FILE');
    expect(buggyLine).not.toContain('HTML_FILE');
  });

  it('SRI script variable-name detector accepts $HTML_FILE', () => {
    const fixedLine = 'done < "$HTML_FILE"';
    expect(fixedLine).toContain('HTML_FILE');
    expect(fixedLine).not.toContain('HTTL_FILE');
  });
});
