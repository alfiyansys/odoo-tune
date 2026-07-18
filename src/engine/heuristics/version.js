/**
 * Odoo version-specific tuning overrides.
 * Different Odoo versions have different ORM behavior, bus architecture,
 * and resource requirements that affect optimal PostgreSQL tuning.
 */

/**
 * Version-specific tuning modifiers.
 * Each version returns a set of multipliers and overrides applied to base heuristics.
 *
 * @param {number} version - 17, 18, or 19
 * @returns {object} Version-specific tuning parameters
 */
export function getVersionTuning(version) {
  switch (version) {
    case 17:
      return {
        /**
         * Odoo 17 introduced the revamped bus (long-polling) module.
         * Older ORM with more heavy FK cascading — needs more lock headroom.
         * Worker-per-connection ratio is slightly higher (less efficient bus).
         */
        label: 'Odoo 17',
        connectionMultiplier: 1.0,
        /** More locks needed for FK-heavy ORM patterns */
        maxLocksPerTransaction: 128,
        /** Standard work_mem — ORM generates moderate sorts */
        workMemMultiplier: 1.0,
        /** Odoo 17 benefits from fresh stats for the older query planner */
        statisticsTargetMultiplier: 1.0,
        /** Slightly less aggressive vacuum than newer versions (less computed field churn) */
        vacuumScaleFactor: 0.015,
        /** Odoo 17 uses gevent on a separate port by default */
        geventPort: 8072,
        /** Older bus module needs more connections headroom */
        busConnectionOverhead: 10,
        /**
         * Version-specific config comment
         */
        configComment: '# Odoo 17: revamped bus module, FK-heavy ORM',
      }

    case 18:
      return {
        label: 'Odoo 18',
        connectionMultiplier: 1.0,
        maxLocksPerTransaction: 128,
        /** Baseline */
        workMemMultiplier: 1.0,
        statisticsTargetMultiplier: 1.0,
        vacuumScaleFactor: 0.01,
        geventPort: 8072,
        busConnectionOverhead: 8,
        configComment: '# Odoo 18: improved ORM, computed field optimizations',
      }

    case 19:
      return {
        label: 'Odoo 19',
        /**
         * Odoo 19 has more computed/stored fields and new AI features.
         * Connection efficiency improved — slightly lower overhead.
         */
        connectionMultiplier: 0.9,
        /** More complex queries with new features */
        maxLocksPerTransaction: 160,
        /**
         * New computed field features and AI integrations generate
         * more complex temp sorts — slightly higher work_mem helps.
         */
        workMemMultiplier: 1.15,
        /**
         * ORM improvements and new field types benefit from better statistics.
         */
        statisticsTargetMultiplier: 1.2,
        /** More aggressive vacuum for computed field churn */
        vacuumScaleFactor: 0.008,
        /** Gevent port same as 18 */
        geventPort: 8072,
        /** Improved bus, lower overhead */
        busConnectionOverhead: 5,
        configComment: '# Odoo 19: computed fields, AI features, improved ORM',
      }

    default:
      return getVersionTuning(18)
  }
}
