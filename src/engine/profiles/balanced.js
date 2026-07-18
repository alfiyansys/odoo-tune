/**
 * Balanced profile — recommended for most Odoo deployments.
 * Mix of OLTP (form views, CRUD) and OLAP (reporting, dashboards).
 * No extreme tuning in any direction.
 */

export const PROFILE_NAME = 'balanced'
export const PROFILE_DESCRIPTION = 'Balanced (recommended) — mixed OLTP + OLAP workload'

/**
 * Profile multipliers applied to base heuristics.
 */
export const profile = {
  /** Multiplier for work_mem. 1.0 = balanced */
  workMemMultiplier: 1.0,
  /** Multiplier for shared_buffers fraction (0.25 * multiplier) */
  sharedBuffersMultiplier: 1.0,
  /** Extra autovacuum aggressiveness (higher = more frequent) */
  vacuumAggressiveness: 1.0,
  /** Parallelism preference (higher = more parallel workers) */
  parallelismMultiplier: 1.0,
  /** Connection pool recommendation */
  recommendedPool: 'transaction',
}
