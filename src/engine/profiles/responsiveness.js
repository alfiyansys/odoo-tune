/**
 * Responsiveness profile — user-facing OLTP-heavy workload.
 * For Odoo instances used primarily for daily operations (form views, list views,
 * point of sale, e-commerce frontend).
 * Favors smaller work_mem (avoid OOM with many concurrent users), less parallelism,
 * and very aggressive vacuum to prevent bloat from slowing form views.
 */

export const PROFILE_NAME = 'responsiveness'
export const PROFILE_DESCRIPTION = 'Responsiveness (OLTP) — form views, POS, e-commerce, daily ops'

export const profile = {
  /** Lower work_mem to avoid OOM with many concurrent users */
  workMemMultiplier: 0.5,
  /** Smaller shared_buffers — OS cache is faster for OLTP patterns */
  sharedBuffersMultiplier: 0.8,
  /** Most aggressive vacuum — form views suffer from bloat */
  vacuumAggressiveness: 1.8,
  /** Minimal parallelism (OLTP queries are small) */
  parallelismMultiplier: 0.5,
  /** Transaction pooling essential for many short-lived connections */
  recommendedPool: 'transaction',
}
