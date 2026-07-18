/**
 * Reporting profile — OLAP-heavy workload.
 * For Odoo instances used primarily for BI, reporting, and dashboards.
 * Favors larger work_mem, more parallelism, and fresher statistics.
 */

export const PROFILE_NAME = 'reporting'
export const PROFILE_DESCRIPTION = 'Reporting (OLAP-heavy) — BI, dashboards, large aggregations'

export const profile = {
  /** Higher work_mem for complex aggregations and sorts */
  workMemMultiplier: 1.5,
  /** Standard shared_buffers */
  sharedBuffersMultiplier: 1.0,
  /** More aggressive analysis for fresh statistics on reporting tables */
  vacuumAggressiveness: 1.3,
  /** Higher parallelism for faster aggregation queries */
  parallelismMultiplier: 1.5,
  /** Transaction pooling still recommended */
  recommendedPool: 'transaction',
}
