/**
 * Memory tuning heuristics for Odoo-optimized PostgreSQL.
 *
 * Odoo's ORM generates many temp sorts (ORDER BY through relations),
 * frequent joins across ir_relation, and heavy caching of ORM tables.
 * These formulas are conservative to avoid OOM while ensuring good performance.
 */

/**
 * Calculate shared_buffers.
 * Odoo benefits from caching ORM metadata and frequently accessed tables.
 * Capped at 16GB — beyond that, OS-level caching is more effective.
 *
 * @param {number} totalRamGB - Total system RAM in GB
 * @returns {{ value: number, unit: string, configLine: string, rationale: string, warning?: string }}
 */
export function calcSharedBuffers(totalRamGB) {
  const raw = Math.round(totalRamGB * 0.25)
  const value = Math.min(raw, 16)
  const warning = value > 12
    ? 'High shared_buffers may cause double-caching with OS page cache. Consider 12GB instead.'
    : undefined

  return {
    value,
    unit: 'GB',
    configLine: `shared_buffers = ${value}GB`,
    rationale: `25% of system RAM (${totalRamGB}GB × 0.25 = ${raw}GB)${raw > 16 ? ', capped at 16GB' : ''}. Odoo caches ORM metadata (ir_model, ir_view, ir_ui_menu) and frequently queried tables in shared buffers. Beyond 16GB, OS cache is more efficient for infrequent access.`,
    warning,
  }
}

/**
 * Calculate effective_cache_size.
 * Includes shared_buffers + OS page cache estimate.
 * PostgreSQL uses this for query planning cost estimates.
 *
 * @param {number} totalRamGB - Total system RAM in GB
 * @returns {{ value: number, unit: string, configLine: string, rationale: string }}
 */
export function calcEffectiveCacheSize(totalRamGB) {
  const value = Math.round(totalRamGB * 0.67)

  return {
    value,
    unit: 'GB',
    configLine: `effective_cache_size = ${value}GB`,
    rationale: `67% of system RAM (${totalRamGB}GB × 0.67 = ${value}GB). This tells the query planner how much memory is available for caching (shared_buffers + OS cache). Odoo's ORM relies heavily on index scans — accurate cache size helps the planner choose index scans over seq scans.`,
  }
}

/**
 * Calculate work_mem (per-operation, per-session).
 * Odoo ORM generates many sort/hash operations through relations.
 * Conservative to avoid OOM with many concurrent connections.
 *
 * @param {number} totalRamGB - Total system RAM in GB
 * @param {number} maxConnections - Expected max PostgreSQL connections
 * @param {number} [profileMultiplier=1] - Profile adjustment (0.5 for responsive, 1.5 for reporting)
 * @returns {{ value: number, unit: string, configLine: string, rationale: string, warning?: string }}
 */
export function calcWorkMem(totalRamGB, maxConnections, profileMultiplier = 1) {
  const availableMemMB = totalRamGB * 1024 * 0.75
  const rawPerConnection = availableMemMB / (maxConnections * 8)
  const value = Math.max(4, Math.min(Math.round(rawPerConnection * profileMultiplier), 256))
  const warning = value > 128
    ? 'High work_mem may cause OOM with many concurrent sort operations. Monitor `temp_files` in pg_stat_database.'
    : value < 8
      ? 'Very low work_mem will cause heavy temp file writes for sorts. Consider reducing max_connections or adding RAM.'
      : undefined

  return {
    value,
    unit: 'MB',
    configLine: `work_mem = ${value}MB`,
    rationale: `75% of RAM (${totalRamGB}GB × 0.75 = ${Math.round(availableMemMB)}MB) ÷ (max_connections × 8) × ${profileMultiplier} = ${value}MB. Odoo's ORM generates many sort operations through relational field access (e.g., order_date on sale.order.line through sale.order). Too low → heavy temp file I/O. Too high → OOM risk with many concurrent heavy queries.`,
    warning,
  }
}

/**
 * Calculate maintenance_work_mem.
 * Used for VACUUM, CREATE INDEX, ADD FOREIGN KEY.
 * Odoo imports, module upgrades, and index rebuilds benefit from larger values.
 *
 * @param {number} totalRamGB - Total system RAM in GB
 * @returns {{ value: number, unit: string, configLine: string, rationale: string }}
 */
export function calcMaintenanceWorkMem(totalRamGB) {
  const raw = Math.round(totalRamGB * 0.05)
  const value = Math.min(raw, 2)

  return {
    value,
    unit: 'GB',
    configLine: `maintenance_work_mem = ${value}GB`,
    rationale: `5% of system RAM (${totalRamGB}GB × 0.05 = ${raw}GB)${raw > 2 ? ', capped at 2GB' : ''}. Odoo module installations and updates run heavy DDL (CREATE INDEX, ALTER TABLE). Higher maintenance_work_mem speeds up index creation and VACUUM. During big imports or module upgrades, this is critical.`,
  }
}

/**
 * Calculate wal_buffers.
 * Small buffer for WAL writes. Default (16MB) is usually fine.
 *
 * @param {number} sharedBuffersMB - shared_buffers in MB
 * @returns {{ value: number, unit: string, configLine: string, rationale: string }}
 */
export function calcWalBuffers(sharedBuffersMB, minimumMB) {
  const minVal = minimumMB ?? 16
  const value = Math.min(Math.max(minVal, Math.round(sharedBuffersMB * 0.02)), 64)

  return {
    value,
    unit: 'MB',
    configLine: `wal_buffers = ${value}MB`,
    rationale: `2% of shared_buffers (${sharedBuffersMB}MB × 0.02 = ${value}MB), clamped to 16-64MB. Odoo's frequent small writes (write_date updates on every record change) benefit from adequate WAL buffering to batch writes.`,
  }
}

/**
 * Generate the full memory section of postgresql.conf.
 *
 * @param {object} params
 * @param {number} params.totalRamGB
 * @param {number} params.maxConnections
 * @param {number} [params.profileMultiplier=1]
 * @returns {{ config: string, params: object, warnings: string[] }}
 */
export function generateMemoryConfig({ totalRamGB, maxConnections, profileMultiplier = 1, walBuffersMB }) {
  const shared = calcSharedBuffers(totalRamGB)
  const cache = calcEffectiveCacheSize(totalRamGB)
  const work = calcWorkMem(totalRamGB, maxConnections, profileMultiplier)
  const maint = calcMaintenanceWorkMem(totalRamGB)
  const wal = calcWalBuffers(shared.value * 1024, walBuffersMB)

  const warnings = [shared.warning, work.warning].filter(Boolean)

  const config = `# --- Memory ---
${shared.configLine}
${cache.configLine}
${work.configLine}
${maint.configLine}
${wal.configLine}
`

  return { config, params: { shared, cache, work, maint, wal }, warnings }
}
