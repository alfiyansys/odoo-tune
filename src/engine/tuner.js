/**
 * OdooTune — Core tuning engine.
 *
 * Orchestrates all heuristics to generate complete PostgreSQL and Odoo
 * configuration optimized for Odoo ERP workloads.
 *
 * Usage:
 *   import { tune } from './engine/tuner.js'
 *   const result = tune({ totalRamGB: 32, cpuCores: 8, ... })
 *   console.log(result.postgresqlConf)
 *   console.log(result.odooConf)
 */

import { generateMemoryConfig } from './heuristics/memory.js'
import { generateAutovacuumConfig } from './heuristics/autovacuum.js'
import { generateWorkersConfig } from './heuristics/workers.js'
import { generatePlannerConfig } from './heuristics/planner.js'
import { generateOdooConfig } from './heuristics/odoo-conf.js'
import { getVersionTuning } from './heuristics/version.js'

import * as balancedProfile from './profiles/balanced.js'
import * as reportingProfile from './profiles/reporting.js'
import * as throughputProfile from './profiles/throughput.js'
import * as responsivenessProfile from './profiles/responsiveness.js'

/** Map of available profiles */
export const PROFILES = {
  balanced: balancedProfile,
  reporting: reportingProfile,
  throughput: throughputProfile,
  responsiveness: responsivenessProfile,
}

export const PROFILE_NAMES = Object.keys(PROFILES)

/** Default inputs */
const DEFAULTS = {
  totalRamGB: 16,
  cpuCores: 4,
  diskType: 'ssd',
  maxConnections: 100,
  odooVersion: 18,
  users: 50,
  multiCompany: false,
  batchHeavy: false,
  dbSize: 'medium',
  connPool: 'transaction',
  profile: 'balanced',
  deployment: 'same',  // 'same' = Odoo+PG on one machine, 'separate' = dedicated machines
}

/**
 * Validate and normalize inputs.
 * @param {object} inputs
 * @returns {object} Normalized inputs
 * @throws {Error} On invalid inputs
 */
export function normalizeInputs(inputs) {
  const i = { ...DEFAULTS, ...inputs }

  if (i.totalRamGB < 1) throw new Error('totalRamGB must be at least 1 GB')
  if (i.cpuCores < 1) throw new Error('cpuCores must be at least 1')
  if (i.users < 1) throw new Error('users must be at least 1')
  if (i.maxConnections < 10) throw new Error('maxConnections must be at least 10')

  const validDisks = ['ssd', 'nvme', 'hdd', 'cloud']
  if (!validDisks.includes(i.diskType)) throw new Error(`diskType must be one of: ${validDisks.join(', ')}`)

  const validSizes = ['small', 'medium', 'large', 'very-large']
  if (!validSizes.includes(i.dbSize)) throw new Error(`dbSize must be one of: ${validSizes.join(', ')}`)

  const validPools = ['none', 'transaction', 'session']
  if (!validPools.includes(i.connPool)) throw new Error(`connPool must be one of: ${validPools.join(', ')}`)

  if (!PROFILES[i.profile]) throw new Error(`profile must be one of: ${PROFILE_NAMES.join(', ')}`)

  const validVersions = [17, 18, 19]
  if (!validVersions.includes(i.odooVersion)) throw new Error(`odooVersion must be one of: ${validVersions.join(', ')}`)

  const validDeployments = ['same', 'separate']
  if (!validDeployments.includes(i.deployment)) throw new Error(`deployment must be one of: ${validDeployments.join(', ')}`)

  return i
}

/**
 * Split resources between PostgreSQL and Odoo when co-located.
 * Returns dedicated RAM for PG and Odoo.
 */
function splitResources(totalRamGB, deployment) {
  if (deployment === 'separate') {
    return { pgRamGB: totalRamGB, odooRamGB: totalRamGB, osReserveGB: 0 }
  }
  // Same machine: PG gets 65% of usable RAM, Odoo gets 35%, OS reserve 10%
  const osReserveGB = Math.max(1, Math.round(totalRamGB * 0.1))
  const remaining = totalRamGB - osReserveGB
  const pgRamGB = Math.round(remaining * 0.65)
  const odooRamGB = remaining - pgRamGB
  return { pgRamGB, odooRamGB, osReserveGB }
}

/**
 * Main tuning function.
 *
 * @param {object} inputs
 * @returns {object} Tuning result with postgresqlConf, odooConf, params, warnings
 */
export function tune(inputs = {}) {
  const i = normalizeInputs(inputs)
  const profileData = PROFILES[i.profile].profile
  const vTuning = getVersionTuning(i.odooVersion)
  const { pgRamGB, odooRamGB, osReserveGB } = splitResources(i.totalRamGB, i.deployment)

  // --- PostgreSQL config (uses PG's share of RAM) ---
  const memory = generateMemoryConfig({
    totalRamGB: pgRamGB,
    maxConnections: i.maxConnections,
    profileMultiplier: profileData.workMemMultiplier * vTuning.workMemMultiplier,
  })

  const autovacuum = generateAutovacuumConfig({ cpuCores: i.cpuCores, diskType: i.diskType })

  const workers = generateWorkersConfig({
    expectedUsers: i.users,
    cpuCores: i.cpuCores,
    connPool: i.connPool,
  })

  const planner = generatePlannerConfig({ diskType: i.diskType, dbSize: i.dbSize })

  // --- Odoo config (uses Odoo's share of RAM) ---
  const odoo = generateOdooConfig({
    totalRamGB: odooRamGB,
    cpuCores: i.cpuCores,
    maxConnections: workers.pgParams.maxConn.value,
    dbSize: i.dbSize,
    odooVersion: i.odooVersion,
  })

  // --- WAL / Checkpoint section (uses PG's share) ---
  const walConfig = generateWALConfig({ totalRamGB: pgRamGB, batchHeavy: i.batchHeavy })

  // --- Lock management (version-aware) ---
  const lockConfig = generateLockConfig(vTuning.maxLocksPerTransaction)

  // --- Assemble full postgresql.conf ---
  const deploymentLabel = i.deployment === 'same'
    ? `Co-located with Odoo (PG: ${pgRamGB}GB, Odoo: ${odooRamGB}GB, OS: ${osReserveGB}GB)`
    : 'Dedicated server (separate from Odoo)'

  const postgresqlConf = `# =================================================================
# OdooTune - PostgreSQL Configuration for Odoo
# Generated for: ${i.profile} profile, ${i.totalRamGB}GB RAM, ${i.cpuCores} cores, ${i.diskType} disk
# Odoo version: ${i.odooVersion}  |  Users: ~${i.users}  |  DB size: ${i.dbSize}
${vTuning.configComment}
# Deployment: ${deploymentLabel}
# =================================================================
# WARNING: Always test in staging before applying to production!
# =================================================================

${memory.config}
${autovacuum.config}
${workers.config}
${planner.config}
${walConfig.config}
${lockConfig.config}

# --- Misc ---
track_activity_query_size = 4096
idle_in_transaction_session_timeout = 300000
statement_timeout = 0
`

  const warnings = [
    ...memory.warnings,
    ...autovacuum.warnings,
    ...workers.warnings,
    ...planner.warnings,
    ...walConfig.warnings,
  ]

  return {
    postgresqlConf,
    odooConf: odoo.config,
    params: {
      memory: memory.params,
      autovacuum: autovacuum.params,
      workers: workers.pgParams,
      odoo: { ...workers.odooParams, ...odoo.params },
      planner: planner.params,
      wal: walConfig.params,
      version: vTuning,
      resourceSplit: { pgRamGB, odooRamGB, osReserveGB, deployment: i.deployment },
    },
    warnings,
    inputs: i,
    profileName: i.profile,
    profileDescription: PROFILES[i.profile].PROFILE_DESCRIPTION,
  }
}

/**
 * Generate WAL / Checkpoint configuration.
 * @private
 */
function generateWALConfig({ totalRamGB, batchHeavy = false }) {
  const multiplier = batchHeavy ? 2 : 1
  const maxWalGB = Math.max(2, Math.min(Math.round(totalRamGB * 0.1 * multiplier), 16))
  const minWalGB = Math.round(maxWalGB / 2)

  return {
    config: `# --- WAL / Checkpoints ---
max_wal_size = ${maxWalGB}GB
min_wal_size = ${minWalGB}GB
checkpoint_completion_target = 0.9
wal_buffers = 16MB
`,
    params: { maxWalSize: maxWalGB, minWalSize: minWalGB, checkpointTarget: 0.9 },
    warnings: [],
  }
}

/**
 * Generate lock management configuration (version-aware).
 * @private
 */
function generateLockConfig(maxLocks) {
  return {
    config: `# --- Lock Management ---
max_locks_per_transaction = ${maxLocks}
max_pred_locks_per_transaction = ${maxLocks}
deadlock_timeout = 5s
`,
    params: { maxLocks, maxPredLocks: maxLocks, deadlockTimeout: '5s' },
  }
}
