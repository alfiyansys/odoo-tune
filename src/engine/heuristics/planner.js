/**
 * Query planner tuning heuristics for Odoo-optimized PostgreSQL.
 *
 * Odoo's ORM generates queries that heavily rely on:
 * - Index scans (btree indexes on FK columns)
 * - Nested loop joins (through relational fields)
 * - Sort operations (ORDER BY through relations)
 * - Subquery scans (ir.rule injects WHERE EXISTS ...)
 *
 * Planner settings must reflect fast storage (SSD/NVMe) and
 * the need for accurate statistics (Odoo's dynamic schema).
 */

/**
 * Calculate random_page_cost.
 * Cost of a non-sequential (random) page fetch.
 * Modern storage has much lower random I/O cost than HDDs.
 *
 * @param {string} diskType - 'nvme', 'ssd', 'hdd', 'cloud'
 * @returns {{ value: number, unit: string, configLine: string, rationale: string }}
 */
export function calcRandomPageCost(diskType) {
  const costs = {
    nvme: 1.1,
    ssd: 1.5,
    hdd: 4.0,
    cloud: 1.5, // Most cloud volumes are SSD-backed
  }
  const value = costs[diskType] ?? 1.5

  return {
    value,
    unit: '',
    configLine: `random_page_cost = ${value}`,
    rationale: `Set to ${value} for ${diskType} storage. Default 4.0 is designed for HDDs and causes PostgreSQL to favor sequential scans over index scans. Odoo's ORM generates many index lookups (FK traversals, ir.rule subqueries) — correct random_page_cost ensures the planner prefers index scans.`,
  }
}

/**
 * Calculate effective_io_concurrency.
 * How many concurrent I/O operations the storage can handle.
 *
 * @param {string} diskType - 'nvme', 'ssd', 'hdd', 'cloud'
 * @returns {{ value: number, unit: string, configLine: string, rationale: string }}
 */
export function calcEffectiveIOConcurrency(diskType) {
  const values = {
    nvme: 200,
    ssd: 100,
    hdd: 2,
    cloud: 100,
  }
  const value = values[diskType] ?? 100

  return {
    value,
    unit: '',
    configLine: `effective_io_concurrency = ${value}`,
    rationale: `${value} concurrent I/O operations for ${diskType}. Controls how many prefetch requests PostgreSQL issues in parallel during bitmap heap scans. Odoo often does partial-match queries through relational fields that benefit from bitmap scans.`,
  }
}

/**
 * Calculate default_statistics_target.
 * Number of most-common values and histogram bins collected by ANALYZE.
 * Higher values = better query plans, slower ANALYZE.
 * Odoo's ORM joins + ir.rule filters benefit from accurate statistics.
 *
 * @param {number} dbSize - 'small' (<10GB), 'medium' (10-100GB), 'large' (>100GB), 'very-large' (>500GB)
 * @returns {{ value: number, unit: string, configLine: string, rationale: string, warning?: string }}
 */
export function calcDefaultStatisticsTarget(dbSize) {
  const targets = {
    'small': 500,
    'medium': 500,
    'large': 1000,
    'very-large': 1000,
  }
  const value = targets[dbSize] ?? 500
  const warning = value > 500
    ? 'Higher statistics_target improves query plans but increases ANALYZE time and memory. Monitor autovacuum worker duration.'
    : undefined

  return {
    value,
    unit: '',
    configLine: `default_statistics_target = ${value}`,
    rationale: `Set to ${value} for ${dbSize} database. Odoo's ORM generates complex multi-table joins with many WHERE conditions from ir.rule filters. Accurate statistics (most-common values, correlation, histogram) help the planner choose optimal join orders and index scans. Default 100 is often too low.`,
    warning,
  }
}

/**
 * Calculate parallelism cost factors.
 * parallel_tuple_cost and parallel_setup_cost discourage parallelism for
 * small queries (OLTP form views) but allow it for larger ones (reporting).
 *
 * @returns {{ tupleCost: number, setupCost: number, configLines: string, rationale: string }}
 */
export function calcParallelCosts() {
  return {
    tupleCost: 0.01,
    setupCost: 100,
    configLines: `parallel_tuple_cost = 0.01\nparallel_setup_cost = 100`,
    rationale: `Default values. Keeps parallelism decision balanced — small Odoo form/list view queries won't spawn parallel workers (overhead too high), but reporting queries and large aggregations will benefit.`,
  }
}

/**
 * Generate the full planner section of postgresql.conf.
 *
 * @param {object} params
 * @param {string} params.diskType
 * @param {string} params.dbSize
 * @returns {{ config: string, params: object, warnings: string[] }}
 */
export function generatePlannerConfig({ diskType, dbSize, randomPageCost: rpcOverride, ioConcurrency: iocOverride }) {
  const baseRandCost = calcRandomPageCost(diskType)
  const baseIoConc = calcEffectiveIOConcurrency(diskType)

  // Apply PG version overrides (PG 17 knows SSDs, lower RPC)
  const randCost = rpcOverride != null
    ? { ...baseRandCost, value: rpcOverride, configLine: `random_page_cost = ${rpcOverride}`, rationale: baseRandCost.rationale }
    : baseRandCost
  const ioConc = iocOverride != null
    ? { ...baseIoConc, value: iocOverride, configLine: `effective_io_concurrency = ${iocOverride}`, rationale: baseIoConc.rationale }
    : baseIoConc
  const statsTarget = calcDefaultStatisticsTarget(dbSize)
  const parallel = calcParallelCosts()

  const warnings = [statsTarget.warning].filter(Boolean)

  const config = `# --- Query Planner ---
${randCost.configLine}
${ioConc.configLine}
${statsTarget.configLine}
${parallel.configLines}
`

  return { config, params: { randCost, ioConc, statsTarget, parallel }, warnings }
}
