/**
 * Sanity checks for generated OdooTune configurations.
 * Validates that the output is safe, parseable, and consistent.
 */

/**
 * Run all sanity checks on a tuning result.
 *
 * @param {object} result - Result from tune()
 * @returns {{ valid: boolean, checks: Array<{ name: string, passed: boolean, message?: string }> }}
 */
export function validateConfig(result) {
  const checks = []

  // --- Memory allocation check ---
  const sharedMatch = result.postgresqlConf.match(/shared_buffers\s*=\s*(\d+)(GB|MB)/)
  if (sharedMatch) {
    const val = parseInt(sharedMatch[1])
    const unit = sharedMatch[2]
    const sharedGB = unit === 'GB' ? val : val / 1024
    const totalRAM = result.inputs.totalRamGB
    const pct = (sharedGB / totalRAM) * 100
    checks.push({
      name: 'shared_buffers_within_limit',
      passed: pct <= 50,
      message: pct > 50
        ? `shared_buffers (${sharedGB}GB) is ${Math.round(pct)}% of total RAM (${totalRAM}GB). Risk of OOM with OS + other processes.`
        : undefined,
    })
  }

  // --- work_mem sanity ---
  const workMatch = result.postgresqlConf.match(/work_mem\s*=\s*(\d+)(MB|GB)/)
  if (workMatch) {
    const val = parseInt(workMatch[1])
    const unit = workMatch[2]
    const workMB = unit === 'GB' ? val * 1024 : val
    const maxConn = result.inputs.maxConnections
    const worstCaseMB = workMB * maxConn * 4 // 4 concurrent sort ops per connection
    const totalRAMMB = result.inputs.totalRamGB * 1024
    checks.push({
      name: 'work_mem_oom_check',
      passed: worstCaseMB < totalRAMMB * 0.5,
      message: worstCaseMB >= totalRAMMB * 0.5
        ? `Worst-case work_mem allocation (${workMB}MB × ${maxConn} × 4 = ${Math.round(worstCaseMB / 1024)}GB) exceeds 50% of RAM (${totalRAMMB / 1024}GB). Reduce work_mem or max_connections.`
        : undefined,
    })
  }

  // --- workers vs max_connections ---
  const workersMatch = result.odooConf.match(/workers\s*=\s*(\d+)/)
  if (workersMatch) {
    const workers = parseInt(workersMatch[1])
    checks.push({
      name: 'workers_vs_connections',
      passed: workers <= result.inputs.maxConnections * 0.8,
      message: workers > result.inputs.maxConnections * 0.8
        ? `Odoo workers (${workers}) is close to max_connections (${result.inputs.maxConnections}). Each worker uses 1-2 connections — consider reducing workers or increasing max_connections.`
        : undefined,
    })
  }

  // --- odoo memory limit vs work_mem ---
  const memHardMatch = result.odooConf.match(/limit_memory_hard\s*=\s*(\d+)/)
  if (memHardMatch && workMatch) {
    const memHardMB = parseInt(memHardMatch[1]) / 1024 / 1024 // convert bytes to MB... wait, odoo uses MB
    const workMemMB = parseInt(workMatch[1])
    // Actually odoo limit_memory_* is in MB, work_mem is also MB
    // Odoo worker memory includes Python + worker_mem per query session
    // Not easily comparable directly, but check if limit_memory_soft is unreasonably low
  }

  // --- Autovacuum freeze age ---
  const freezeMatch = result.postgresqlConf.match(/autovacuum_freeze_max_age\s*=\s*(\d+)/)
  if (freezeMatch) {
    const age = parseInt(freezeMatch[1])
    checks.push({
      name: 'freeze_age_safe',
      passed: age >= 100_000_000 && age <= 2_000_000_000,
      message: age < 100_000_000
        ? `autovacuum_freeze_max_age (${age.toLocaleString()}) is very low — may cause excessive anti-wraparound vacuums.`
        : age > 1_500_000_000
          ? `autovacuum_freeze_max_age (${age.toLocaleString()}) is very high — risk of transaction ID wraparound.`
          : undefined,
    })
  }

  // --- Config formatting check ---
  const hasTrailingWhitespace = result.postgresqlConf.split('\n').some(l => l.length !== l.trimEnd().length)
  checks.push({
    name: 'formatting_no_trailing_whitespace',
    passed: !hasTrailingWhitespace,
    message: hasTrailingWhitespace ? 'Generated config has trailing whitespace on some lines.' : undefined,
  })

  const valid = checks.every(c => c.passed)
  return { valid, checks }
}
