/**
 * Database module entry point (backend/src/db).
 *
 * Exposes core database lifecycle, transactional migration runner,
 * schema integrity installers, and health check utilities.
 */

export * from '../services/db';
export * from './migrator';
export { LEGACY_BASELINE_VERSION } from './legacySchema';
