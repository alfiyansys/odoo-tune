/**
 * Odoo configuration file generation.
 * Generates optimized odoo.conf settings based on hardware and deployment specs.
 *
 * Key considerations:
 * - workers should match PostgreSQL connection capacity
 * - limit_memory_soft/hard prevent OOM from memory-hungry workers
 * - longpolling workers need their own port
 * - dbfilter prevents cross-database access in multi-tenant setups
 */

/**
 * Calculate Odoo workers.
 * Each worker handles one HTTP request at a time.
 * Re-exports the logic from workers.js for convenience.
 *
 * @param {number} cpuCores
 * @param {number} maxConnections
 * @returns {{ value: number, configLine: string, rationale: string, warning?: string }}
 */
export function calcOdooWorkers(cpuCores, maxConnections) {
  const byCpu = cpuCores * 2 + 1
  const byConn = Math.round(maxConnections / 2)
  const value = Math.min(byCpu, byConn)
  const warning = value < 3
    ? 'Very few Odoo workers. Users may experience queueing during peak load.'
    : value > 30
      ? 'High worker count increases memory pressure. Ensure limit_memory_soft/hard are set correctly.'
      : undefined

  return {
    value,
    configLine: `workers = ${value}`,
    rationale: `min(cpu_cores×2+1=${byCpu}, max_connections/2=${byConn}) = ${value}. Each worker handles one request at a time. Too few → requests queue (especially during report generation). Too many → RAM exhaustion.`,
    warning,
  }
}

/**
 * Calculate memory limits for Odoo workers.
 * limit_memory_soft = per-worker soft limit (triggers GC)
 * limit_memory_hard = per-worker hard limit (worker killed if exceeded)
 *
 * @param {number} totalRamGB
 * @param {number} workers - Number of Odoo workers
 * @returns {{ soft: object, hard: object }}
 */
export function calcMemoryLimits(totalRamGB, workers) {
  const totalRamMB = totalRamGB * 1024
  const osReserve = Math.round(totalRamMB * 0.3) // 30% for OS + PostgreSQL
  const availForOdoo = totalRamMB - osReserve
  const perWorker = Math.round(availForOdoo / (workers + 2)) // +2 for cron + longpolling

  const softValue = Math.max(64, Math.min(perWorker, 1024))
  const hardValue = Math.max(128, Math.min(Math.round(perWorker * 1.2), 1536))

  return {
    soft: {
      value: softValue,
      unit: 'MB',
      configLine: `limit_memory_soft = ${softValue}`,
      rationale: `~${softValue}MB per worker. (~${totalRamMB}MB total - 30% OS/PG reserve) / (${workers} + 2 workers). Triggers GC when worker reaches this threshold. Prevents Odoo workers from accumulating memory.`,
    },
    hard: {
      value: hardValue,
      unit: 'MB',
      configLine: `limit_memory_hard = ${hardValue}`,
      rationale: `${Math.round(perWorker * 1.2)}MB (soft × 1.2). Worker process killed if memory exceeds this. Essential safety net for memory leaks from custom Odoo modules.`,
    },
  }
}

/**
 * Calculate request/response limits.
 *
 * @param {'small' | 'medium' | 'large' | 'very-large'} dbSize
 * @returns {{ limitRequest: object, limitTimeCpu: object, limitTimeReal: object }}
 */
export function calcRequestLimits(dbSize) {
  const configs = {
    'small':      { request: 8192, cpu: 60, real: 120 },
    'medium':     { request: 16384, cpu: 120, real: 240 },
    'large':      { request: 32768, cpu: 300, real: 600 },
    'very-large': { request: 65536, cpu: 600, real: 1200 },
  }
  const c = configs[dbSize] ?? configs.medium

  return {
    limitRequest: {
      value: c.request,
      unit: 'KB',
      configLine: `limit_request = ${c.request}`,
      rationale: `${c.request}KB (${Math.round(c.request / 1024)}MB) max request size. Odoo imports/reports can produce large requests. ${dbSize} database tier.`,
    },
    limitTimeCpu: {
      value: c.cpu,
      unit: 's',
      configLine: `limit_time_cpu = ${c.cpu}`,
      rationale: `${c.cpu}s CPU time limit per request. Odoo report generation can be CPU-intensive. ${dbSize} database needs more time for complex aggregations.`,
    },
    limitTimeReal: {
      value: c.real,
      unit: 's',
      configLine: `limit_time_real = ${c.real}`,
      rationale: `${c.real}s real (wall-clock) time limit. Accounts for I/O waits, network, and database query time. Double the CPU limit for ${dbSize} databases.`,
    },
  }
}

/**
 * Calculate database connection pool settings.
 *
 * @param {number} maxConnections - PostgreSQL max_connections
 * @returns {{ dbMaxConn: object, dbPoolLimit: object }}
 */
export function calcDBPool(maxConnections) {
  const dbMaxConn = Math.round(maxConnections * 0.85)
  const dbPoolLimit = Math.max(4, Math.round(dbMaxConn / 4))

  return {
    dbMaxConn: {
      value: dbMaxConn,
      unit: 'connections',
      configLine: `db_maxconn = ${dbMaxConn}`,
      rationale: `85% of PostgreSQL max_connections (${maxConnections} × 0.85 = ${dbMaxConn}). Odoo's connection pool uses this many connections. Leaves headroom for superuser and maintenance connections.`,
    },
    dbPoolLimit: {
      value: dbPoolLimit,
      unit: 'connections',
      configLine: `dbpool_limit_connections = ${dbPoolLimit}`,
      rationale: `~25% of db_maxconn (${dbMaxConn} / 4 = ${dbPoolLimit}). Limits connections per database in multi-tenant setups. Prevents one database from starving others.`,
    },
  }
}

/**
 * Generate longpolling configuration.
 *
 * @param {number} [port]
 * @returns {{ port: number, geventPort: number, configLines: string, rationale: string }}
 */
export function calcLongpolling(port) {
  const longPollPort = port ?? 8072
  const geventPort = longPollPort

  return {
    port: longPollPort,
    geventPort,
    configLines: `longpolling_port = ${longPollPort}\ngevent_port = ${geventPort}`,
    rationale: `Long-polling on port ${longPollPort} handles Odoo's real-time notifications (bus chatter, message inbox, live updates). Separate port prevents request queuing from blocking notifications.`,
  }
}

/**
 * Generate a complete odoo.conf content.
 *
 * @param {object} params
 * @param {number} params.totalRamGB
 * @param {number} params.cpuCores
 * @param {number} params.maxConnections
 * @param {string} params.dbSize
 * @returns {{ config: string, params: object, warnings: string[] }}
 */
export function generateOdooConfig({ totalRamGB, cpuCores, maxConnections, dbSize }) {
  const workers = calcOdooWorkers(cpuCores, maxConnections)
  const memLimits = calcMemoryLimits(totalRamGB, workers.value)
  const requestLimits = calcRequestLimits(dbSize)
  const dbPool = calcDBPool(maxConnections)
  const longpoll = calcLongpolling()

  const warnings = [workers.warning].filter(Boolean)

  const config = `# --- OdooTune Generated Configuration ---
# Optimized for: ${cpuCores} cores, ${totalRamGB}GB RAM, ${dbSize} database

[options]

# --- Workers ---
${workers.configLine}
max_cron_threads = ${Math.min(workers.value, 5)}

# --- Memory Limits ---
${memLimits.soft.configLine}
${memLimits.hard.configLine}

# --- Request Limits ---
${requestLimits.limitRequest.configLine}
${requestLimits.limitTimeCpu.configLine}
${requestLimits.limitTimeReal.configLine}

# --- Database Connection ---
${dbPool.dbMaxConn.configLine}
${dbPool.dbPoolLimit.configLine}

# --- Long-polling ---
${longpoll.configLines}

# --- Security (recommended) ---
# proxy_mode = True          # Uncomment if behind nginx/apache
# dbfilter = ^%d$            # Database filter for multi-tenant
# admin_passwd = <CHANGE_ME> # Always set a strong admin password
`

  return { config, params: { workers, memLimits, requestLimits, dbPool, longpoll }, warnings }
}
