/**
 * PostgreSQL version-specific tuning overrides.
 * Different PG versions have different defaults and capabilities
 * that affect optimal tuning output.
 */

/**
 * @param {number} version - PostgreSQL major version (12-17)
 * @returns {object} Version-specific tuning parameters
 */
export function getPgVersionTuning(version) {
  switch (version) {
    case 12:
    case 13:
    case 14:
      return {
        label: `PostgreSQL ${version}`,
        /** PG 14 and below: wal_buffers default is 4MB, suggest explicit 16MB */
        walBuffersMB: 16,
        /** Older PG: lower concurrency default, safe to raise for SSDs */
        effectiveIoConcurrency: 200,
        /** Before PG 15, no maintenance_io_concurrency — skip */
        maintenanceIoConcurrency: null,
        /** Before PG 16, no autovacuum_vacuum_insert_threshold — skip */
        insertThresholdSupported: false,
        /** Standard random_page_cost for non-PG17 */
        randomPageCost: 1.5,
        /** Oomph factor for parallelism */
        parallelWorkerMultiplier: 1.0,
        configComment: `# PostgreSQL ${version}: stable, well-tested`,
      }

    case 15:
      return {
        label: `PostgreSQL ${version}`,
        /** PG 15: still 4MB default */
        walBuffersMB: 16,
        effectiveIoConcurrency: 200,
        /** PG 15: maintenance_io_concurrency added */
        maintenanceIoConcurrency: 10,
        insertThresholdSupported: false,
        randomPageCost: 1.5,
        parallelWorkerMultiplier: 1.1,
        configComment: `# PostgreSQL ${version}: sort improvements,更好并行性`,
      }

    case 16:
      return {
        label: `PostgreSQL ${version}`,
        /** PG 16: wal_buffers default raised to 16MB — our 16MB matches */
        walBuffersMB: 16,
        /** PG 16: effective_io_concurrency default 200 for SSD */
        effectiveIoConcurrency: 200,
        maintenanceIoConcurrency: 10,
        /** PG 16: autovacuum insert threshold added */
        insertThresholdSupported: true,
        randomPageCost: 1.5,
        parallelWorkerMultiplier: 1.2,
        configComment: `# PostgreSQL ${version}: insert vacuum, better defaults`,
      }

    case 17:
      return {
        label: `PostgreSQL ${version}`,
        /** PG 17: wal_buffers default is now 16MB */
        walBuffersMB: 16,
        /** PG 17: knows about SSDs — random_page_cost default auto-tunes */
        effectiveIoConcurrency: 200,
        maintenanceIoConcurrency: 10,
        insertThresholdSupported: true,
        /** PG 17 defaults to 1.1 on SSD — our 1.5 is too conservative */
        randomPageCost: 1.1,
        /** PG 17: better parallelism, especially for Odoo-style queries */
        parallelWorkerMultiplier: 1.3,
        configComment: `# PostgreSQL ${version}: SSD-aware planner, better parallelism`,
      }

    default:
      // Default to PG 16 for unrecognized versions
      return getPgVersionTuning(16)
  }
}

/**
 * Supported PostgreSQL versions for the selector.
 */
export const SUPPORTED_PG_VERSIONS = [
  { value: 14, label: 'PostgreSQL 14' },
  { value: 15, label: 'PostgreSQL 15' },
  { value: 16, label: 'PostgreSQL 16' },
  { value: 17, label: 'PostgreSQL 17' },
]
