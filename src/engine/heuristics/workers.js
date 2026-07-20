/**
 * Workers and connection tuning heuristics for Odoo-optimized PostgreSQL.
 *
 * Odoo's architecture:
 * - Each Odoo worker uses ~1-2 PostgreSQL connections
 * - Long-polling workers (bus connections) hold connections for extended periods
 * - Cron workers connect periodically
 * - Session pooling (PgBouncer) can dramatically reduce DB connections
 */

/**
 * Calculate max_connections.
 * Odoo needs more connections than typical apps due to long-polling.
 * With PgBouncer, we can set lower values.
 *
 * @param {number} expectedUsers - Concurrent Odoo users
 * @param {string} connPool - 'none', 'transaction', 'session'
 * @returns {{ value: number, unit: string, configLine: string, rationale: string, warning?: string }}
 */
export function calcMaxConnections(expectedUsers, connPool = 'transaction') {
  const multiplier = connPool === 'transaction' ? 1.5 : connPool === 'session' ? 2.5 : 4
  const raw = Math.round(expectedUsers * multiplier)
  const value = Math.max(20, Math.min(raw, 500))
  const warning = value > 300
    ? 'High max_connections increases context switching and lock contention. Strongly consider PgBouncer transaction pooling.'
    : value > 500
      ? 'max_connections above 500 is dangerous. Use PgBouncer transaction pooling instead.'
      : undefined

  return {
    value,
    unit: 'connections',
    configLine: `max_connections = ${value}`,
    rationale: `~${expectedUsers} users × ${multiplier}× (${connPool} pooling) = ${raw}, clamped to 20-500. Odoo needs headroom for long-polling bus connections, cron workers, and background tasks. ${connPool === 'transaction' ? 'PgBouncer transaction pooling shares connections efficiently.' : connPool === 'none' ? 'Without pooling, each Odoo worker needs its own DB connection — plus bus workers.' : 'Session pooling keeps connections tied to sessions; less efficient than transaction.'}`,
    warning,
  }
}

/**
 * Calculate superuser_reserved_connections.
 * Always keep a few for admin access during connection storms.
 *
 * @param {number} maxConnections
 * @returns {{ value: number, unit: string, configLine: string, rationale: string }}
 */
export function calcReservedConnections(maxConnections) {
  const value = Math.min(5, Math.max(3, Math.round(maxConnections * 0.03)))

  return {
    value,
    unit: 'connections',
    configLine: `superuser_reserved_connections = ${value}`,
    rationale: `${value} connections reserved for superuser admin access. Essential for troubleshooting when all regular connections are exhausted — e.g., during Odoo cron storms.`,
  }
}

/**
 * Calculate max_worker_processes.
 * Background workers for parallel queries, logical replication, etc.
 *
 * @param {number} cpuCores
 * @returns {{ value: number, unit: string, configLine: string, rationale: string }}
 */
export function calcMaxWorkerProcesses(cpuCores) {
  const value = Math.max(8, cpuCores * 2)

  return {
    value,
    unit: 'processes',
    configLine: `max_worker_processes = ${value}`,
    rationale: `${cpuCores} cores × 2 = ${value}. Background workers power autovacuum, parallel queries, and maintenance. Odoo profits from parallel query workers for reporting queries.`,
  }
}

/**
 * Calculate max_parallel_workers.
 * Maximum parallel workers across all sessions.
 *
 * @param {number} cpuCores
 * @returns {{ value: number, unit: string, configLine: string, rationale: string }}
 */
export function calcMaxParallelWorkers(cpuCores) {
  const value = Math.max(2, cpuCores)

  return {
    value,
    unit: 'workers',
    configLine: `max_parallel_workers = ${value}`,
    rationale: `max(${cpuCores}, 2) = ${value}. Parallel workers speed up Odoo reporting and large aggregation queries without overwhelming CPU.`,
  }
}

/**
 * Calculate max_parallel_workers_per_gather.
 * Parallel workers per single query.
 *
 * @param {number} cpuCores
 * @returns {{ value: number, unit: string, configLine: string, rationale: string, warning?: string }}
 */
export function calcMaxParallelWorkersPerGather(cpuCores) {
  const value = Math.max(1, Math.min(Math.round(cpuCores / 2), 4))
  const warning = value > 2
    ? 'High parallel workers per gather may cause contention on OLTP queries. Odoo form views are OLTP — consider keeping this at 2.'
    : undefined

  return {
    value,
    unit: 'workers',
    configLine: `max_parallel_workers_per_gather = ${value}`,
    rationale: `floor(${cpuCores}/2) = ${value}, clamped to 1-4. Each parallel query gather uses up to ${value} workers. Good for Odoo reporting/BI queries, but high values hurt OLTP (form views, list views).`,
    warning,
  }
}

/**
 * Generate Odoo worker count recommendation.
 * Each Odoo worker handles HTTP requests; too few = queueing, too many = memory pressure.
 *
 * @param {number} cpuCores
 * @param {number} maxConnections
 * @param {number} [expectedUsers] - For ratio-based warnings
 * @returns {{ workers: number, rationale: string, warning?: string }}
 */
export function calcOdooWorkers(cpuCores, maxConnections, expectedUsers) {
  const byCpu = cpuCores * 2 + 1
  const byConn = Math.round(maxConnections / 2)
  const value = Math.min(byCpu, byConn)

  // User-aware warnings
  let warning = undefined
  const ratio = expectedUsers ? Math.round(expectedUsers / value) : null
  if (value < 3) {
    warning = 'Very few Odoo workers. Users may experience severe queueing during peak load.' +
      (ratio > 20 ? ' Ratio: ~1 worker per ' + ratio + ' users — expect long wait times.' : '')
  } else if (ratio !== null && ratio > 15) {
    warning = 'Too few Odoo workers: ' + value + ' for ~' + expectedUsers + ' users (1:' + ratio + ' ratio). Each worker handles one request at a time. Recommended max ratio is 1:15. Consider adding more CPU cores to Odoo or using separate servers.'
  } else if (value === byCpu && ratio !== null && ratio > 10) {
    warning = 'Worker count limited by CPU (' + cpuCores + ' cores → ' + value + ' workers). For ~' + expectedUsers + ' users (1:' + ratio + ' ratio), consider dedicated Odoo server for more cores.'
  } else if (value > 30) {
    warning = 'High worker count increases memory pressure. Ensure limit_memory_soft/hard are set correctly.'
  }

  return {
    value,
    configLine: `workers = ${value}`,
    rationale: `min(cpu_cores×2+1=${byCpu}, max_connections/2=${byConn}) = ${value}. Each Odoo worker handles one request at a time. Too few → requests queue. Too many → memory exhaustion (each worker can use 150-250MB).`,
    warning,
  }
}

/**
 * Generate the full connections/workers section of postgresql.conf.
 *
 * @param {object} params
 * @param {number} params.expectedUsers
 * @param {number} params.cpuCores - CPU cores for PG-side parallelism
 * @param {number} params.odooCores - CPU cores allocated to Odoo (for worker calc)
 * @param {string} params.connPool
 * @returns {{ config: string, pgParams: object, odooParams: object, warnings: string[] }}
 */
export function generateWorkersConfig({ expectedUsers, cpuCores, odooCores = cpuCores, connPool = 'transaction' }) {
  const maxConn = calcMaxConnections(expectedUsers, connPool)
  const reserved = calcReservedConnections(maxConn.value)
  const maxWorkers = calcMaxWorkerProcesses(cpuCores)
  const parallelWorkers = calcMaxParallelWorkers(cpuCores)
  const perGather = calcMaxParallelWorkersPerGather(cpuCores)
  const odooWorkers = calcOdooWorkers(odooCores, maxConn.value, expectedUsers)

  const pgWarnings = [maxConn.warning, perGather.warning].filter(Boolean)
  const odWarnings = [odooWorkers.warning].filter(Boolean)

  const config = `# --- Connections & Parallelism ---
${maxConn.configLine}
${reserved.configLine}
${maxWorkers.configLine}
${parallelWorkers.configLine}
${perGather.configLine}
`

  return {
    config,
    pgParams: { maxConn, reserved, maxWorkers, parallelWorkers, perGather },
    odooParams: { odooWorkers },
    warnings: [...pgWarnings, ...odWarnings],
  }
}
