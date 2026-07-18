import { tune, PROFILE_NAMES, PROFILES } from '../../engine/tuner.js'
import { validateConfig } from '../../engine/validators/sanity.js'

/**
 * Creates a reactive tuning store.
 * In Svelte 5, we use $state() in the component directly,
 * but this module provides the initial state and helper functions.
 */

/** @returns {object} Default form state */
export function defaultInputs() {
  return {
    totalRAMGB: 16,
    totalCPUCores: 4,
    diskType: 'ssd',
    users: 50,
    odooVersion: 18,
    pgVersion: 16,
    dbSize: 'medium',
    connPool: 'transaction',
    profile: 'balanced',
    deployment: 'same',
    osReserveGB: undefined,  // undefined = auto-calculate
    multiCompany: false,
    batchHeavy: false,
  }
}

/** @returns {string[]} All profile names for UI dropdown */
export function getProfileNames() {
  return PROFILE_NAMES
}

/** @returns {string} Profile description */
export function getProfileDescription(name) {
  return PROFILES[name]?.PROFILE_DESCRIPTION ?? ''
}

/**
 * Run the tuning engine with given inputs.
 * Returns the full result or an error object.
 *
 * @param {object} inputs
 * @returns {{ ok: boolean, data?: any, error?: string }}
 */
export function runTuning(inputs) {
  try {
    const result = tune(inputs)
    const validation = validateConfig(result)
    return { ok: true, data: { ...result, validation } }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}
