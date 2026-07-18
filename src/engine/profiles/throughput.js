/**
 * Throughput profile — batch/import-heavy workload.
 * For Odoo instances with large imports, bulk updates, server actions.
 * Favors larger maintenance_work_mem, aggressive vacuum, and bigger WAL.
 */

export const PROFILE_NAME = 'throughput'
export const PROFILE_DESCRIPTION = 'Throughput (batch-heavy) — imports, bulk updates, mass editing'

export const profile = {
  /** Lower work_mem per query (batch ops use sequential scans) */
  workMemMultiplier: 0.75,
  /** Larger shared_buffers for batch scan caching */
  sharedBuffersMultiplier: 1.2,
  /** More aggressive vacuum (batch ops generate lots of dead tuples) */
  vacuumAggressiveness: 1.5,
  /** Moderate parallelism */
  parallelismMultiplier: 0.8,
  /** Session pooling may be better for long-running batch scripts */
  recommendedPool: 'session',
}
