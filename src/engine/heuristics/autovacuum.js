/**
 * Autovacuum tuning heuristics for Odoo-optimized PostgreSQL.
 *
 * Odoo is notorious for bloat because:
 * - Every record write updates write_date, write_uid (frequent updates)
 * - Computed/stored fields cause cascading updates
 * - ir.rule / ir.model.access generate many system table queries
 * - mail_message, stock_move, account_move_line are high-churn tables
 *
 * Default PostgreSQL autovacuum settings (scale_factor=0.2) are WAY too
 * conservative for Odoo. We tune aggressively but safely.
 */

/**
 * Calculate autovacuum_max_workers.
 * More workers = better concurrency for vacuuming multiple tables.
 * Odoo has many hot tables that need simultaneous vacuuming.
 *
 * @param {number} cpuCores
 * @returns {{ value: number, unit: string, configLine: string, rationale: string }}
 */
export function calcAutovacuumMaxWorkers(cpuCores) {
  const value = Math.max(3, Math.round(cpuCores / 2))

  return {
    value,
    unit: 'workers',
    configLine: `autovacuum_max_workers = ${value}`,
    rationale: `Max(3, cpu_cores/2) = max(3, ${cpuCores}/2) = ${value}. Odoo has multiple high-churn tables (mail_message, stock_move, account_move_line) that often need vacuuming simultaneously. More workers prevent one table's bloat from blocking others.`,
  }
}

/**
 * Calculate autovacuum_naptime.
 * How often autovacuum launcher checks for needed work.
 * Odoo generates dead tuples quickly — shorter naptime catches bloat earlier.
 *
 * @param {number} [customSeconds]
 * @returns {{ value: number, unit: string, configLine: string, rationale: string }}
 */
export function calcAutovacuumNaptime(customSeconds) {
  const value = customSeconds ?? 30

  return {
    value,
    unit: 's',
    configLine: `autovacuum_naptime = ${value}s`,
    rationale: `Odoo's rapid dead tuple generation (every write_date update creates a dead tuple) means the default 60s naptime allows significant bloat to accumulate between checks. ${value}s ensures faster detection.`,
  }
}

/**
 * Calculate autovacuum_vacuum_scale_factor.
 * Fraction of a table that must be dead before VACUUM triggers.
 * Default 0.2 (20%) is far too high for Odoo — tables with 1M rows would
 * accumulate 200K dead tuples before vacuuming.
 *
 * @param {number} [customFactor]
 * @returns {{ value: number, unit: string, configLine: string, rationale: string, warning?: string }}
 */
export function calcVacuumScaleFactor(customFactor) {
  const value = customFactor ?? 0.01

  return {
    value,
    unit: '',
    configLine: `autovacuum_vacuum_scale_factor = ${value}`,
    rationale: `Default is 0.2 (20%) — far too high for Odoo. At ${value} (${value * 100}%), vacuum triggers when ${value * 100}% of a table is dead tuples. Combined with threshold, this catches bloat early without excessive vacuuming.`,
    warning: value < 0.005
      ? 'Very aggressive vacuum scale factor will increase vacuum frequency. May cause I/O pressure on busy systems.'
      : undefined,
  }
}

/**
 * Calculate autovacuum_vacuum_threshold.
 * Minimum dead tuples before VACUUM triggers (combined with scale factor).
 *
 * @param {number} [customThreshold]
 * @returns {{ value: number, unit: string, configLine: string, rationale: string }}
 */
export function calcVacuumThreshold(customThreshold) {
  const value = customThreshold ?? 500

  return {
    value,
    unit: 'tuples',
    configLine: `autovacuum_vacuum_threshold = ${value}`,
    rationale: `Minimum dead tuple threshold. At ${value}, small tables get vacuumed promptly while the scale factor handles large tables. Default 50 is too low — causes frequent vac on tiny system tables.`,
  }
}

/**
 * Calculate autovacuum_analyze_scale_factor.
 * Fraction of a table that must change before ANALYZE triggers.
 * Odoo benefits from fresh statistics for the ORM's complex joins.
 *
 * @param {number} [customFactor]
 * @returns {{ value: number, unit: string, configLine: string, rationale: string }}
 */
export function calcAnalyzeScaleFactor(customFactor) {
  const value = customFactor ?? 0.005

  return {
    value,
    unit: '',
    configLine: `autovacuum_analyze_scale_factor = ${value}`,
    rationale: `At ${value} (${value * 100}%), ANALYZE runs after ${value * 100}% of a table changes. Odoo's ORM generates complex multi-table joins — fresh statistics are critical for good query plans. Default 0.1 (10%) is too stale.`,
  }
}

/**
 * Calculate autovacuum_freeze_max_age.
 * Maximum age before forced vacuum to prevent transaction ID wraparound.
 * Odoo databases with long-running batch jobs or high transaction rates
 * are at risk of wraparound.
 *
 * @param {number} [customAge]
 * @returns {{ value: number, unit: string, configLine: string, rationale: string, warning?: string }}
 */
export function calcFreezeMaxAge(customAge) {
  const value = customAge ?? 500_000_000

  return {
    value,
    unit: 'transactions',
    configLine: `autovacuum_freeze_max_age = ${value}`,
    rationale: `${value.toLocaleString()} transactions before forced anti-wraparound vacuum. Odoo generates many transactions (every write_date update). This gives headroom before the aggressive freeze kicks in. Default 200M may be too tight for busy Odoo instances.`,
    warning: value > 800_000_000
      ? 'Very high freeze age delays anti-wraparound vacuum. Ensure regular manual VACUUM FREEZE during maintenance windows.'
      : undefined,
  }
}

/**
 * Calculate vacuum_cost_limit and vacuum_cost_delay.
 * Controls how aggressively vacuum runs (throttling).
 * Odoo needs aggressive vacuum but not at the cost of production I/O.
 *
 * @param {string} diskType - 'nvme', 'ssd', 'hdd', 'cloud'
 * @returns {{ costLimit: number, costDelay: number, configLines: string, rationale: string }}
 */
export function calcVacuumCost(diskType) {
  const costs = {
    nvme: { limit: 2000, delay: 5 },
    ssd:  { limit: 2000, delay: 10 },
    hdd:  { limit: 500,  delay: 20 },
    cloud: { limit: 1000, delay: 15 },
  }
  const { limit, delay } = costs[diskType] ?? costs.ssd

  return {
    costLimit: limit,
    costDelay: delay,
    configLines: `vacuum_cost_limit = ${limit}\nvacuum_cost_delay = ${delay}ms`,
    rationale: `vacuum_cost_limit=${limit} allows ${diskType === 'hdd' ? 'moderate' : 'aggressive'} vacuum I/O. vacuum_cost_delay=${delay}ms pauses between I/O bursts. Odoo needs vacuum to keep up with write_date churn, but ${diskType} cannot sustain unlimited vacuum writes.`,
  }
}

/**
 * Generate the full autovacuum section of postgresql.conf.
 *
 * @param {object} params
 * @param {number} params.cpuCores
 * @param {string} params.diskType
 * @returns {{ config: string, params: object, warnings: string[] }}
 */
export function generateAutovacuumConfig({ cpuCores, diskType, insertThresholdSupported = false }) {
  const workers = calcAutovacuumMaxWorkers(cpuCores)
  const naptime = calcAutovacuumNaptime()
  const vacScale = calcVacuumScaleFactor()
  const vacThreshold = calcVacuumThreshold()
  const analyzeScale = calcAnalyzeScaleFactor()
  const freezeAge = calcFreezeMaxAge()
  const vacuumCost = calcVacuumCost(diskType)

  const warnings = [vacScale.warning, freezeAge.warning].filter(Boolean)

  const insertSection = insertThresholdSupported
    ? `autovacuum_vacuum_insert_threshold = 1000
autovacuum_vacuum_insert_scale_factor = 0.01
`
    : ''

  const config = `# --- Autovacuum (Odoo-tuned) ---
${workers.configLine}
${naptime.configLine}
${vacScale.configLine}
${vacThreshold.configLine}
${analyzeScale.configLine}
${insertSection}${freezeAge.configLine}
${vacuumCost.configLines}
`

  return { config, params: { workers, naptime, vacScale, vacThreshold, analyzeScale, freezeAge, vacuumCost }, warnings }
}
