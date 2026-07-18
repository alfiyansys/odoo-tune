<div align="center">
  <h1>OdooTune</h1>
  <p><strong>PostgreSQL &amp; Odoo configuration tuner for Odoo ERP deployments</strong></p>
  <p>
    <a href="https://trustmedis.github.io/odoo-tune/">Live Demo</a> ·
    <a href="#features">Features</a> ·
    <a href="#getting-started">Getting Started</a> ·
    <a href="#how-it-works">How It Works</a> ·
    <a href="#deployment">Deployment</a>
  </p>
</div>

---

OdooTune is a **pure client-side** web application that generates optimized `postgresql.conf` and `odoo.conf` files tailored to your hardware, workload, and deployment topology. No backend, no database — all tuning runs in your browser.

## Why OdooTune?

Odoo's ORM generates unique database workloads that generic PostgreSQL tuners don't account for:

- **Frequent small writes** — every `write_date` update on every record change creates dead tuple churn
- **Nested loop joins** — relational field traversal (e.g., `sale.order.line` through `sale.order`) needs index-only scans
- **`ir.rule` subqueries** — multi-company/record rule filters create complex `WHERE EXISTS` patterns
- **Computed/stored fields** — Odoo 18+ generates more complex query plans

Generic tools like `pgtune` optimize for broad PostgreSQL workloads. OdooTune understands Odoo.

## Features

- **Deployment-aware resource splitting** — choose co-located (same machine) or dedicated servers. RAM and CPU are split between OS, PostgreSQL, and Odoo automatically
- **Version-aware tuning** — Odoo 17, 18, and 19 each get different work_mem, lock, and vacuum settings. PostgreSQL 14–17 affects planner costs, WAL buffers, and autovacuum features
- **4 tuning profiles** — Balanced, Reporting, Throughput, and Responsiveness with per-aspect multipliers
- **Odoo conf generator** — workers, memory limits, request limits, and DB pool sizing
- **Sanity validation** — checks for OOM risk, worker/connection imbalance, freeze age, and formatting
- **Interactive sliders** — drag or type exact values for RAM, CPU, users, and OS reserve
- **Download configs** — save generated `.conf` files directly
- **Zero backend** — static HTML/JS, host anywhere (GitHub Pages, Netlify, S3)

## Quick Start

```bash
git clone https://github.com/trustmedis/odoo-tune.git
cd odoo-tune
npm install
npm run dev
```

Open `http://localhost:5173/` and start tuning.

### Build for production

```bash
npm run build
```

Static files are output to `dist/` — deploy anywhere.

## How It Works

```
                   ┌──────────────────┐
                   │   Input Form     │
                   │  RAM · CPU · Disk │
                   │  Users · Version  │
                   │  Profile · Deploy │
                   └────────┬─────────┘
                            │
                            ▼
                   ┌──────────────────┐
                   │  Tuner Engine    │
                   │  (pure JS)       │
                   └────────┬─────────┘
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
    ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
    │  Memory     │ │ Autovacuum  │ │  Workers    │
    │  Heuristic  │ │ Heuristic   │ │  Heuristic  │
    └─────────────┘ └─────────────┘ └─────────────┘
    ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
    │  Planner    │ │  Odoo Conf  │ │  Profiles   │
    │  Heuristic  │ │  Heuristic  │ │  × Versions  │
    └─────────────┘ └─────────────┘ └─────────────┘
              │             │
              ▼             ▼
    ┌─────────────────────────────────────┐
    │     postgresql.conf · odoo.conf     │
    │     Warnings · Parameter Details    │
    └─────────────────────────────────────┘
```

### Resource splitting (co-located mode)

When PostgreSQL and Odoo share a machine, resources are divided:

| Resource | OS Reserve | PostgreSQL (65%) | Odoo (35%) |
|----------|-----------|------------------|------------|
| **RAM**  | ~10%  | 65% of remaining | 35% of remaining |
| **CPU**  | min 1, max 2 cores | 65% of remaining | 35% of remaining |

Each subsystem only sees its share — no over-allocation.

## Profiles

| Profile | Description |
|---------|-------------|
| **Balanced** | Default. Good mix of throughput and responsiveness for typical Odoo workloads |
| **Reporting** | Biased toward large aggregations and read-heavy workloads. Higher work_mem, more parallelism |
| **Throughput** | Maximizes transaction throughput. More workers, aggressive vacuum |
| **Responsiveness** | Minimizes latency for interactive users. Lower work_mem, more connections |

## Parameters tuned

### PostgreSQL

| Category | Parameters |
|----------|-----------|
| **Memory** | `shared_buffers`, `effective_cache_size`, `work_mem`, `maintenance_work_mem`, `wal_buffers` |
| **Autovacuum** | `autovacuum_max_workers`, `autovacuum_naptime`, `scale_factor` (0.01 vs default 0.2), `threshold`, `freeze_max_age`, `vacuum_cost_limit/delay`, `vacuum_insert_threshold` (PG 16+) |
| **Connections** | `max_connections`, `superuser_reserved_connections`, `max_worker_processes`, `max_parallel_workers`, `max_parallel_workers_per_gather` |
| **Planner** | `random_page_cost`, `effective_io_concurrency`, `default_statistics_target`, `parallel_tuple_cost`, `parallel_setup_cost` |
| **WAL** | `max_wal_size`, `min_wal_size`, `checkpoint_completion_target` |
| **Locks** | `max_locks_per_transaction`, `max_pred_locks_per_transaction`, `deadlock_timeout` |
| **Misc** | `track_activity_query_size`, `idle_in_transaction_session_timeout` |

### Odoo

| Category | Parameters |
|----------|-----------|
| **Workers** | `workers`, `max_cron_threads` |
| **Memory** | `limit_memory_soft`, `limit_memory_hard` |
| **Requests** | `limit_request`, `limit_time_cpu`, `limit_time_real` |
| **Database** | `db_maxconn`, `dbpool_limit_connections` |

## Development

```
src/
├── engine/
│   ├── heuristics/
│   │   ├── memory.js         # shared_buffers, work_mem, cache, WAL buffers
│   │   ├── autovacuum.js     # Vacuum tuning (Odoo-optimized)
│   │   ├── workers.js        # max_connections, parallelism, Odoo workers
│   │   ├── planner.js        # Query planner costs and statistics
│   │   ├── odoo-conf.js      # odoo.conf generation
│   │   ├── version.js        # Odoo version differences (17/18/19)
│   │   └── pg-version.js     # PostgreSQL version differences (14-17)
│   ├── profiles/
│   │   ├── balanced.js
│   │   ├── reporting.js
│   │   ├── throughput.js
│   │   └── responsiveness.js
│   ├── validators/
│   │   └── sanity.js         # OOM/formatting/conflict checks
│   └── tuner.js              # Orchestrator
├── app/
│   ├── components/
│   │   ├── InputForm.svelte  # Sidebar form with all inputs
│   │   └── SliderInput.svelte # Reusable slider + number input
│   └── stores/
│       └── tuning.js         # Svelte reactive state
├── App.svelte                # Two-column layout
├── app.css                   # Tailwind + custom styles
└── main.js                   # Entry point
```

## License

MIT © [alfiyansys](https://github.com/trustmedis)
