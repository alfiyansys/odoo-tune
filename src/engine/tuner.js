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
import { generateOdooConfig, calcOdooWorkers } from './heuristics/odoo-conf.js'
import { generateNginxConfig } from './heuristics/nginx.js'
import { getVersionTuning } from './heuristics/version.js'
import { getPgVersionTuning } from './heuristics/pg-version.js'

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
  totalRAMGB: 16,
  totalCPUCores: 4,
  diskType: 'ssd',
  maxConnections: 100,
  odooVersion: 18,
  pgVersion: 16,
  users: 50,
  multiCompany: false,
  batchHeavy: false,
  dbSize: 'medium',
  connPool: 'transaction',
  profile: 'balanced',
  deployment: 'same',  // 'same' = Odoo+PG on one machine, 'separate' = dedicated machines
  osReserveGB: undefined,  // undefined = auto-calculate based on total RAM
  useNginx: false,
}

/**
 * Validate and normalize inputs.
 * @param {object} inputs
 * @returns {object} Normalized inputs
 * @throws {Error} On invalid inputs
 */
export function normalizeInputs(inputs) {
  const i = { ...DEFAULTS, ...inputs }

  if (i.totalRAMGB < 1) throw new Error('totalRAMGB must be at least 1 GB')
  if (i.totalCPUCores < 1) throw new Error('totalCPUCores must be at least 1')
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

  if (typeof i.useNginx !== 'boolean') throw new Error('useNginx must be a boolean')

  const validPgVersions = [14, 15, 16, 17]
  if (!validPgVersions.includes(i.pgVersion)) throw new Error(`pgVersion must be one of: ${validPgVersions.join(', ')}`)

  return i
}

/**
 * Split resources between PostgreSQL and Odoo when co-located.
 * Returns dedicated RAM for PG and Odoo.
 */
function splitResources(totalRamGB, cpuCores, deployment, osReserveGBOverride, useNginx = false) {
  if (deployment === 'separate') {
    return {
      pgRamGB: totalRamGB, odooRamGB: totalRamGB, osReserveGB: 0, nginxReserveGB: 0,
      pgCores: cpuCores, odooCores: cpuCores, osCores: 0,
    }
  }
  // Same machine: calculate OS reserve (auto or manual)
  const osReserveGB = osReserveGBOverride != null
    ? osReserveGBOverride
    : Math.max(1, Math.round(totalRamGB * 0.1))

  // --- NGINX reserve (when reverse proxy is enabled) ---
  // NGINX needs modest memory for proxy buffers, SSL session cache, and worker processes.
  // When enabled, bump the OS reserve to include nginx's share.
  let nginxReserveGB = 0
  if (useNginx && osReserveGBOverride == null) {
    nginxReserveGB = Math.max(0.5, Math.round(totalRamGB * 0.03))
  }

  // --- RAM split ---
  const effectiveOSReserveGB = osReserveGB + nginxReserveGB
  const remainingRAM = Math.max(1, totalRamGB - effectiveOSReserveGB)
  const pgRamGB = Math.round(remainingRAM * 0.65)
  const odooRamGB = remainingRAM - pgRamGB

  // --- CPU split ---
  // OS gets at least 1 core, capped at 2 cores max (kernel + daemons don't need more).
  // Then PG 65%, Odoo 35% of remaining.
  const osCores = Math.min(Math.max(1, Math.round(cpuCores * 0.1)), 2)
  const remainingCores = Math.max(1, cpuCores - osCores)
  const pgCores = Math.max(1, Math.round(remainingCores * 0.65))
  const odooCores = Math.max(1, remainingCores - pgCores)

  return { pgRamGB, odooRamGB, osReserveGB, nginxReserveGB, pgCores, odooCores, osCores }
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
  const pgVTuning = getPgVersionTuning(i.pgVersion)
  const { pgRamGB, odooRamGB, osReserveGB, nginxReserveGB, pgCores, odooCores, osCores } = splitResources(i.totalRAMGB, i.totalCPUCores, i.deployment, i.osReserveGB, i.useNginx)

  // --- PostgreSQL config (uses PG's share of RAM) ---
  const memory = generateMemoryConfig({
    totalRamGB: pgRamGB,
    maxConnections: i.maxConnections,
    profileMultiplier: profileData.workMemMultiplier * vTuning.workMemMultiplier,
    walBuffersMB: pgVTuning.walBuffersMB,
  })

  const autovacuum = generateAutovacuumConfig({
    cpuCores: pgCores,
    diskType: i.diskType,
    insertThresholdSupported: pgVTuning.insertThresholdSupported,
  })

  const workers = generateWorkersConfig({
    expectedUsers: i.users,
    cpuCores: pgCores,
    odooCores,
    connPool: i.connPool,
  })

  const planner = generatePlannerConfig({
    diskType: i.diskType,
    dbSize: i.dbSize,
    randomPageCost: pgVTuning.randomPageCost,
    ioConcurrency: pgVTuning.effectiveIoConcurrency,
  })

  // --- Odoo config (uses Odoo's share of RAM) ---
  const odoo = generateOdooConfig({
    totalRamGB: odooRamGB,
    cpuCores: odooCores,
    maxConnections: workers.pgParams.maxConn.value,
    dbSize: i.dbSize,
    odooVersion: i.odooVersion,
    expectedUsers: i.users,
  })

  // --- WAL / Checkpoint section (uses PG's share) ---
  const walConfig = generateWALConfig({ totalRamGB: pgRamGB, batchHeavy: i.batchHeavy })

  // --- Lock management (version-aware) ---
  const lockConfig = generateLockConfig(vTuning.maxLocksPerTransaction)

  // --- Assemble full postgresql.conf ---
  const osLabel = i.osReserveGB != null
    ? `OS reserve (manual): ${osReserveGB}GB`
    : `OS reserve (auto): ${osReserveGB}GB`
  const nginxLabel = i.useNginx ? ` + nginx buffers: ${nginxReserveGB}GB` : ''
  const deploymentLabel = i.deployment === 'same'
    ? `Co-located with Odoo (PG: ${pgRamGB}GB/${pgCores}c, Odoo: ${odooRamGB}GB/${odooCores}c, ${osLabel}${nginxLabel})`
    : 'Dedicated server (separate from Odoo)'

  const postgresqlConf = `# =================================================================
# OdooTune - PostgreSQL Configuration for Odoo
# Generated for: ${i.profile} profile, ${i.totalRAMGB}GB RAM, ${i.totalCPUCores} cores, ${i.diskType} disk
# Odoo version: ${i.odooVersion}  |  PG version: ${i.pgVersion}  |  Users: ~${i.users}  |  DB size: ${i.dbSize}
${vTuning.configComment}
${pgVTuning.configComment}
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

  // --- NGINX config (when reverse proxy is enabled) ---
  let nginxConf = ''
  let nginxParams = null
  if (i.useNginx) {
    const odooWorkers = calcOdooWorkers(odooCores, workers.pgParams.maxConn.value, i.users).value
    const nginxResult = generateNginxConfig({
      expectedUsers: i.users,
      odooWorkers,
      dbSize: i.dbSize,
      batchHeavy: i.batchHeavy,
      diskType: i.diskType,
      odooVersion: i.odooVersion,
      busConnectionOverhead: vTuning.busConnectionOverhead,
    })
    nginxConf = nginxResult.config
    nginxParams = nginxResult.params
    warnings.push(...nginxResult.warnings)
  }

  return {
    postgresqlConf,
    odooConf: odoo.config,
    nginxConf,
    params: {
      memory: memory.params,
      autovacuum: autovacuum.params,
      workers: workers.pgParams,
      odoo: { ...workers.odooParams, ...odoo.params },
      nginx: nginxParams,
      planner: planner.params,
      wal: walConfig.params,
      version: vTuning,
      pgVersion: pgVTuning,
      resourceSplit: { pgRamGB, odooRamGB, osReserveGB, nginxReserveGB, pgCores, odooCores, osCores, deployment: i.deployment, useNginx: i.useNginx },
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
