# OdooTune — Plan

**OdooTune** is a specialized **web-based** configuration tuner that generates optimal `postgresql.conf` and `odoo.conf` settings for **Odoo ERP** deployments. Unlike generic tools like PgTune, OdooTune understands Odoo's unique workload patterns — and delivers the results through a clean, interactive UI.

---

## 1. Why Odoo-Specific Tuning Matters

Odoo workloads are distinct from generic PostgreSQL workloads:

| Aspect | Odoo Behavior | Tuning Impact |
|--------|---------------|---------------|
| **ORM queries** | Dynamic joins across `ir.relation`, multi-table `LEFT JOIN`s | Needs higher `work_mem`, careful `random_page_cost` |
| **Row-level security** | `ir.rule` injects `WHERE EXISTS (...)` on almost every query | Query planner benefits from accurate stats → aggressive `autovacuum` |
| **Frequent updates** | `write_date`, `write_uid`, `create_date`, `create_uid` change on every record write | Heavy autovacuum pressure, bloat risk |
| **Mixed workload** | OLTP (form views, CRUD) + OLAP (reporting, dashboards) | Need balanced config — not purely OLTP or OLAP |
| **Long-polling** | Bus connections hold connections open for long periods | Requires high `max_connections` or PgBouncer |
| **Multi-tenancy** | Multi-company filters via PostgreSQL row-level security | Partitioned or large `work_mem` for filtered aggregations |
| **Custom fields** | Dynamic columns via `ir.model.fields` + `ir.property` | Frequent DDL → careful lock management needed |
| **Batch operations** | Imports, server actions, mass editing | Needs adequate `maintenance_work_mem` |

---

## 2. Inputs

OdooTune accepts user-provided system specs and deployment info:

| Input | Description | Default |
|-------|-------------|---------|
| `totalRam` | Total system RAM (GB) | Required |
| `cpuCores` | Number of CPU cores | Required |
| `diskType` | `ssd`, `nvme`, `hdd`, `cloud` | `ssd` |
| `maxConnections` | Expected DB connections | `100` |
| `odooVersion` | `17`, `18`, etc. | `18` |
| `users` | Concurrent Odoo users (approx) | (inferred from connections) |
| `multiCompany` | Whether multi-company is used | `false` |
| `batchHeavy` | Heavy imports/reports workload | `false` |
| `dbSize` | Database size tier: `small` (<10 GB), `medium` (10–100 GB), `large` (>100 GB), `very-large` (>500 GB) | `medium` |
| `storageRam` | RAM dedicated to PostgreSQL (overrides auto-calculation) | Auto |
| `connPool` | Use PgBouncer? `none`, `transaction`, `session` | `transaction` |
| `profile` | `balanced`, `reporting`, `throughput`, `responsiveness` | `balanced` |

---

## 3. Outputs

OdooTune generates and displays in the browser:

### a) `postgresql.conf` (optimized for Odoo)

| Category | Key Parameters |
|----------|---------------|
| **Memory** | `shared_buffers`, `effective_cache_size`, `work_mem`, `maintenance_work_mem`, `wal_buffers` |
| **Autovacuum** | `autovacuum_max_workers`, `autovacuum_naptime`, `autovacuum_vacuum_scale_factor`, `autovacuum_analyze_scale_factor`, `autovacuum_freeze_max_age` |
| **Query Planner** | `random_page_cost`, `effective_io_concurrency`, `default_statistics_target` |
| **WAL / Checkpoints** | `max_wal_size`, `min_wal_size`, `checkpoint_completion_target`, `wal_buffers` |
| **Connections** | `max_connections`, `superuser_reserved_connections` |
| **Parallelism** | `max_parallel_workers`, `max_parallel_workers_per_gather`, `parallel_tuple_cost` |
| **Lock Management** | `max_locks_per_transaction`, `max_pred_locks_per_transaction` |
| **Misc** | `max_worker_processes`, `track_activity_query_size`, `idle_in_transaction_session_timeout`, `statement_timeout` |

### b) `odoo.conf` (optimized for PostgreSQL + Odoo workload)

| Category | Key Parameters |
|----------|---------------|
| **Workers** | `workers`, `limit_memory_soft`, `limit_memory_hard`, `limit_request`, `limit_time_cpu`, `limit_time_real` |
| **DB Pool** | `db_maxconn`, `db_pool_limit_connections` |
| **Long-polling** | `longpolling_port`, `gevent_port` |
| **Caching** | `proxy_mode`, `dbfilter`, `db_retry_limit` |

### c) Interactive explanation panel

- Side-by-side view: parameter → value → rationale
- Warnings about Odoo-specific pitfalls highlighted in the UI
- Visual health meters (memory allocation %, connection headroom, vacuum pressure)

---

## 4. Tuning Heuristics (Odoo-Aware)

### 4.1 Memory

```js
shared_buffers = min(25% of total_ram, 16 GB)   // Odoo benefits from caching ORM tables
effective_cache_size = 60-75% of total_ram       // OS will cache remaining
work_mem = (total_ram * 0.75) / (max_connections * 8)  // Conservative — Odoo has query-heavy sessions
maintenance_work_mem = min(5% of total_ram, 2 GB)      // For VACUUM, CREATE INDEX (imports!)
```

**Odoo note**: Odoo's ORM generates many temp sorts (ORDER BY through relations). If `work_mem` is too low, temp files are written to disk heavily. If too high, risk of OOM.

### 4.2 Autovacuum (Critical for Odoo)

Odoo records (`res_partner`, `account_move`, `sale_order`, etc.) are **updated frequently** (write_date, sequence fields, computed fields). This causes:

- High dead tuple generation
- Transaction ID wraparound risk on busy databases
- Bloat in indexed tables (especially `ir_attachment`, `mail_message`, `stock_move`)

```js
autovacuum_max_workers = max(3, cpu_cores / 2)     // More aggressive on multi-core
autovacuum_naptime = 30s                            // Odoo default is 1min — too slow!
autovacuum_vacuum_scale_factor = 0.01               // Default 0.2 is WAY too high for Odoo
autovacuum_vacuum_threshold = 500                   // Default 50, increase slightly
autovacuum_analyze_scale_factor = 0.005             // More frequent stats updates
autovacuum_freeze_max_age = 500_000_000             // Odoo + long running transactions risk
vacuum_cost_limit = 2000                            // More aggressive vacuuming
autovacuum_vacuum_cost_delay = 10ms                 // But don't thrash I/O
```

**Odoo-specific per-table overrides** (future feature):
- `mail_message`, `mail_tracking_value`, `stock_move`, `account_move_line` — more aggressive
- `ir_logging` — if audit enabled, very aggressive

### 4.3 Worker / Connection Balance

Odoo workers vs PostgreSQL connections math:

```js
// Each Odoo worker uses ~1-2 PostgreSQL connections
// Longpolling worker also connects
// Cron workers also connect

safe_connections = total_ram / 32 MB                // Rough heuristic
odoo_workers = min(cpu_cores * 2 + 1, max_connections / 2)
```

**PgBouncer recommendation**: Always use transaction pooling for Odoo. Session pooling wastes connections, statement pooling breaks Odoo's session-state dependency.

### 4.4 Planner Tuning

```js
// The ORM generates many index scans and nested loops
// Odoo heavily relies on btree indexes across FK columns
random_page_cost = 1.1 (nvme), 1.5 (ssd), 4.0 (hdd)
effective_io_concurrency = 200 (nvme), 100 (ssd), 2 (hdd)
default_statistics_target = 500-1000                // Better join estimates for ORM
```

### 4.5 Lock Management

Odoo uses many foreign keys (`res_partner` → `sale_order` → `account_move`). Long transactions or batch operations can cause lock escalation.

```js
max_locks_per_transaction = 128  // Default 64 — Odoo batches hit this
deadlock_timeout = 5s            // Detect ORM deadlocks faster
```

---

## 5. Architecture (Web App)

```
odootune/
├── PLAN.md                      # This file
├── package.json                 # Node.js package
├── index.html                   # SPA entry (single HTML + JS + CSS)
├── src/
│   ├── app/                     # Vue/React/Svelte SPA (frontend)
│   │   ├── App.svelte           # Root component
│   │   ├── components/
│   │   │   ├── InputForm.svelte     # System specs form
│   │   │   ├── ConfigOutput.svelte  # Generated config display (tabs: postgresql.conf / odoo.conf)
│   │   │   ├── Explanation.svelte   # Annotated rationale panel
│   │   │   ├── HealthMeters.svelte  # Visual memory/vacuum health gauges
│   │   │   ├── CompareMode.svelte   # Side-by-side profile comparison
│   │   │   └── ExportPanel.svelte   # Download / copy buttons
│   │   ├── stores/
│   │   │   └── tuning.js        # Reactive state for form + results
│   │   └── utils/
│   │       └── config-exporter.js  # Download as .conf / JSON
│   │
│   ├── engine/                  # Pure JS tuning logic (framework-agnostic)
│   │   ├── tuner.js             # Core tuning engine
│   │   ├── heuristics/
│   │   │   ├── memory.js        # Memory calculations
│   │   │   ├── autovacuum.js    # Autovacuum tuning
│   │   │   ├── workers.js       # Workers & connections
│   │   │   ├── planner.js       # Query planner tuning
│   │   │   └── odoo-conf.js     # Odoo config generation
│   │   ├── profiles/
│   │   │   ├── balanced.js      # Mixed workload
│   │   │   ├── reporting.js     # OLAP-heavy (bigger work_mem, more parallelism)
│   │   │   ├── throughput.js    # Batch/import-heavy (bigger maintenance_work_mem)
│   │   │   └── responsiveness.js # User-facing OLTP (smaller work_mem, more aggressive vacuum)
│   │   └── validators/
│   │       └── sanity.js        # Sanity check generated config
│   │
│   └── workers/                 # Web Workers (optional, offload tuning)
│       └── tuner-worker.js
│
├── public/
│   ├── favicon.svg              # Odoo-tune logo
│   └── odoo-bg.svg              # Decorative graphics
│
├── test/
│   ├── memory.test.js
│   ├── autovacuum.test.js
│   └── ...
│
├── examples/
│   ├── small-deployment.json    # 4 GB RAM, 2 cores, 10 users
│   ├── medium-deployment.json   # 16 GB RAM, 8 cores, 50 users
│   └── large-deployment.json    # 64 GB RAM, 16 cores, 200 users
│
├── docs/
│   └── tuning-guide.md          # Linked from the app's "Why these values?" help
│
├── vite.config.js               # Vite for dev/build
└── README.md
```

**Key architectural decisions:**
- **Pure client-side SPA** — No backend needed. All tuning logic runs in the browser via JavaScript. Zero deployment cost (static hosting on Netlify/Vercel/GitHub Pages).
- **Framework-agnostic engine** — The `engine/` directory is pure JS with zero framework dependencies. Easy to reuse in CLI, CI, or API later.
- **Reactive frontend** — Svelte (or Vue/React) for a responsive, form-driven UI with live preview as sliders change.
- **Web Worker** (optional) — For complex calculations, the tuning can be offloaded to a worker to keep the UI responsive.

---

## 6. Web App Usage

### Development

```bash
npm install
npm run dev       # Vite dev server at localhost:5173
npm run build     # Static build to dist/
```

### User Flow

1. User opens `odootune.app` (or static hosted page)
2. Fills in a form:
   - System specs: RAM (slider), CPU cores (slider), disk type (dropdown)
   - Odoo deployment: version, estimated users, DB size tier, multi-company toggle
   - Profile: balanced / reporting / throughput / responsiveness
3. As they adjust inputs, the config **updates live**
4. Two tabs: **postgresql.conf** and **odoo.conf** — syntax-highlighted, copy/paste ready
5. **Explanation panel** shows rationale for each parameter
6. **Health meters** visualize:
   - Memory allocation % (safe vs danger zone)
   - Connection headroom (max_connections vs expected)
   - Autovacuum pressure index
7. **Export**: Copy to clipboard, download as `.conf`, download as JSON

### Screenshot concept

```
┌─────────────────────────────────────────────────────────────┐
│  🛠  OdooTune                                               │
│  Optimize PostgreSQL + Odoo for your hardware              │
├────────────────┬────────────────────────────────────────────┤
│  System Specs  │  📄 postgresql.conf  │ 📄 odoo.conf        │
│                ├────────────────────────────────────────────┤
│  RAM  ═══●══   │  # Odoo-Optimized Configuration           │
│  32 GB         │  shared_buffers = 8GB                      │
│                │  effective_cache_size = 24GB               │
│  CPU  ═══●══   │  work_mem = 32MB                           │
│  8 cores       │  ...                                       │
│                │                                            │
│  Disk  [ssd ▾] │  💡 work_mem at 32MB — Odoo ORM queries   │
│                │  sort moderately large result sets.        │
│  Profile       │  This balances memory safety vs speed.    │
│  [balanced ▾]  │                                            │
│                │  🟢 Memory: 45% allocated                  │
│  🚀 Generate   │  🟡 Connection headroom: 45%              │
│                │  🟢 Vacuum pressure: low                   │
└────────────────┴────────────────────────────────────────────┘
```

---

## 7. Feature Roadmap

### v0.1 (MVP)
- [x] Pure JS tuning engine (memory, autovacuum, workers, planner)
- [x] Svelte SPA with input form
- [x] Live-updating postgresql.conf display
- [x] Live-updating odoo.conf display
- [x] Copy to clipboard
- [x] 4 profiles: balanced, reporting, throughput, responsiveness
- [x] Download generated .conf files

### v0.2
- [ ] Health meters (memory gauge, connection headroom, vacuum pressure)
- [ ] Explanation panel with per-parameter rationale
- [ ] Share config via URL (encode inputs in hash params)
- [ ] PgBouncer detection & recommendation banner
- [ ] Dark mode toggle
- [ ] Input presets (Small / Medium / Large deployment one-click fill)

### v0.3
- [ ] Per-table autovacuum overrides for Odoo hot tables
- [ ] Connection pooling config snippet (pgbouncer.ini)
- [ ] Compare mode — side-by-side profiles
- [ ] `?import=...` — load from existing postgresql.conf and suggest deltas
- [ ] Docker run command generation
- [ ] Systemd service snippet for Odoo

### v0.4
- [ ] CLI companion (Node.js) — `npx odootune` for headless/CI
- [ ] Ansible playbook export
- [ ] PDF report generation
- [ ] i18n (English, Spanish, French, Japanese)
- [ ] PWA — installable, offline-capable

---

## 8. Testing Strategy

| Type | What |
|------|------|
| **Unit** | Each heuristic function in isolation (engine/) |
| **Snapshot** | Generate config for known inputs, compare to golden files |
| **Validation** | Ensure generated postgresql.conf parses (edge cases, float formatting) |
| **E2E** | Playwright — fill form, verify outputs render, copy, download |
| **Edge Cases** | Very small RAM (1 GB), very large (256 GB), cloud (shared vs dedicated) |
| **Odoo Compatibility** | Check that `limit_memory_*` matches PG memory settings |
| **Accessibility** | Keyboard navigation, screen reader labels, ARIA on meters |

---

## 9. Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Over-allocating memory → OOM | Conservative formulas, cap at 75%, show red meter if >60% |
| Under-tuning autovacuum → bloat | Default to aggressive vacuum; visual warning for low I/O setups |
| Odoo version differences | Keep version-specific overrides in a simple `versions.js` map |
| Cloud DB (RDS, Cloud SQL) limitation | When "cloud" disk type selected, reduce shared_buffers, disable some params |
| Too many workers → context switching | Cap workers at `2 * cpu_cores + 1` for OLTP |
| Browser JS disabled | Pure client-side app is an enhancement; core logic still available as Node.js CLI |

---

## 10. Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| **Framework** | **Svelte 5** | Minimal boilerplate, reactive by nature, small bundle |
| **Build** | **Vite** | Fast dev, simple static build |
| **Styling** | **Tailwind CSS** + custom design system | Rapid UI iteration |
| **Engine** | **Pure JavaScript** (zero deps) | Framework-agnostic, portable, testable |
| **Testing** | **Vitest** (unit) + **Playwright** (e2e) | Fast, modern |
| **Hosting** | **GitHub Pages / Netlify** | Free static hosting |
| **CLI** (future) | **Node.js** via `commander` | Reuse engine/ as npm package |

---

## 11. Development

```bash
# Clone & install
git clone ...
cd odootune
npm install

# Dev
npm run dev        # Vite SPA at localhost:5173

# Test
npm run test       # Vitest
npm run test:e2e   # Playwright

# Build
npm run build      # Static to dist/

# Preview production build
npm run preview

# CLI (future)
node bin/odootune.mjs --total-ram 32 --cpu-cores 8
```

---

*This plan evolves as Odoo and PostgreSQL change. PRs and issues welcome.*
