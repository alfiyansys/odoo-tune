# AGENTS.md — Agent Workflow Instructions

This file defines how the AI coding agent should build OdooTune. Follow these instructions strictly.

---

## 0. Git Flow — Branch Strategy

Use a simplified Git Flow with two main branches:

### `main` — Stable / Production
- **Protected** — never commit directly to `main`
- Only receives merges from `dev` via PR (or `git merge dev` when verified)
- Contains GitHub Pages deployment workflow (`.github/workflows/deploy.yml`)
- Leave GitHub Pages config untouched — it lives here permanently

### `dev` — Active Development
- **Default working branch** for all new features, fixes, and improvements
- All commits should target `dev`, not `main`
- When `dev` reaches a stable milestone, merge into `main`:
  ```bash
  git checkout main && git merge dev && git push origin main
  ```

### Feature Branches (optional)
For larger features (spanning multiple commits/days), create a feature branch off `dev`:
```
feature/<short-description>
```
Example: `feature/health-meters`, `feature/share-url`

Merge back to `dev` when complete, then delete the feature branch.

### Rules
- **Never** commit directly to `main`
- Development happens on `dev` (or feature branches off `dev`)
- Push both branches regularly to keep remote in sync

---

## 1. Commit Discipline — Granular Commits Per Logical Progress

Every logical step MUST be committed with a concise, descriptive message. A "logical step" is the smallest meaningful unit of progress that leaves the project in a working (or at least non-regressed) state.

### Commit message format

```
type(scope): brief description

- Bullet point details if needed
- Reference decisions made
```

**Types:** `feat` (new feature), `fix` (bug fix), `chore` (tooling, deps), `docs` (documentation), `refactor` (restructure), `style` (formatting), `test` (testing)

**Scope examples:** `engine`, `ui`, `cli`, `tuner`, `autovacuum`, `memory`, `workers`, `form`, `config-output`, `docs`

### Examples of logical steps (each = one commit)

| Step | Commit Message |
|------|----------------|
| Initialize project with package.json + Vite | `chore(project): scaffold odootune with Vite + Svelte 5` |
| Create pure JS memory heuristic | `feat(engine): add memory tuning heuristic with conservative caps` |
| Add autovacuum engine | `feat(engine): implement autovacuum tuning for Odoo workloads` |
| Wire tuner to form input | `feat(ui): connect input form to live config generation` |
| Add config download | `feat(ui): add copy-to-clipboard and .conf download` |
| Write unit tests for memory | `test(engine): add memory heuristic unit tests` |

### What does NOT warrant a separate commit

- Whitespace fixes — squash with previous logical step
- Comment typos — squash with the feature being documented
- Single-line style changes — squash

### Commit early, commit often

If a feature takes multiple files to implement, commit each file or each logical sub-step as soon as it's independently meaningful. Do not accumulate 10 files of work and commit once.

---

## 2. Build Order (Recommended Sequence)

Follow this order. Each numbered item is at least one commit.

### Phase 0: Project Scaffold
1. `package.json` with dependencies (svelte, vite, tailwind)
2. `vite.config.js` with Svelte plugin
3. `index.html` entry point
4. Basic `App.svelte` shell ("Hello OdooTune")
5. Tailwind setup (`postcss.config.js`, `tailwind.config.js`, base CSS)

### Phase 1: Tuning Engine (Pure JS)
6. `src/engine/heuristics/memory.js` — shared_buffers, work_mem, etc.
7. `src/engine/heuristics/autovacuum.js` — vacuum params
8. `src/engine/heuristics/workers.js` — connection/worker math
9. `src/engine/heuristics/planner.js` — query planner tuning
10. `src/engine/heuristics/odoo-conf.js` — odoo.conf generation
11. `src/engine/profiles/balanced.js` — balanced profile
12. `src/engine/profiles/reporting.js`
13. `src/engine/profiles/throughput.js`
14. `src/engine/profiles/responsiveness.js`
15. `src/engine/tuner.js` — orchestrator that takes inputs + profile → full config
16. `src/engine/validators/sanity.js` — sanity checks (OOM prevention, float formatting)

### Phase 2: UI — Input Form
17. `src/app/components/InputForm.svelte` — system specs form with sliders/dropdowns
18. Wire form reactivity — inputs stored in Svelte store

### Phase 3: UI — Config Output
19. `src/app/components/ConfigOutput.svelte` — tabbed display (postgresql.conf / odoo.conf)
20. Syntax highlighting for config files
21. Copy-to-clipboard button
22. Download `.conf` files

### Phase 4: UI — Explanation & Health
23. `src/app/components/Explanation.svelte` — per-parameter rationale panel
24. `src/app/components/HealthMeters.svelte` — memory gauge, connection headroom
25. Connect explanation data from engine

### Phase 5: Polish
26. Dark mode toggle
27. Preset buttons (small / medium / large deployment)
28. Share config via URL hash
29. Responsive layout (mobile-friendly)

### Phase 6: Testing
30. Unit tests for each heuristic module
31. Snapshot tests for profile outputs
32. E2E test with Playwright (fill form, verify output)

### Phase 7: Deployment
33. GitHub Actions CI
34. Static build config
35. README with screenshots and live demo link

---

## 3. File Change Boundaries

### Do NOT modify these files in unrelated commits
- `AGENTS.md` — only update when workflow rules change
- `PLAN.md` — only update when the overall plan changes

### Every commit should touch files that are thematically related
- A commit titled `feat(engine): add memory heuristic` should ONLY touch:
  - `src/engine/heuristics/memory.js`
  - Possibly `src/engine/tuner.js` if wiring it in
  - `test/engine/memory.test.js` if tests are included
- It should NOT touch unrelated files like `InputForm.svelte` or `autovacuum.js`

---

## 4. Code Style

### JavaScript
- Use modern JS (ES modules, `import`/`export`)
- No TypeScript for now (keep it accessible, no build step for engine)
- `const` by default, `let` only when reassigning
- Use `//` comments for explanations, `/** JSDoc */` for exported functions

### Svelte
- Svelte 5 runes syntax (`$state`, `$derived`, `$effect`)
- One component per file
- Props typed with `let { ... } = $props()`

### Tuning Engine
- Every exported function returns an object with `{ value, unit, rationale, warning? }`
- Example:
  ```js
  export function calcSharedBuffers(totalRamGB) {
    const value = Math.min(Math.round(totalRamGB * 0.25), 16);
    return {
      value,
      unit: 'GB',
      configLine: `shared_buffers = ${value}GB`,
      rationale: '25% of system RAM, capped at 16GB for Odoo...',
      warning: value > 12 ? 'High shared_buffers may cause double-caching with OS' : undefined,
    };
  }
  ```

---

## 5. Before Each Commit — Checklist

- [ ] Does the project still run? (`npm run dev` — or at least no syntax errors)
- [ ] Are all new exports actually used / wired in?
- [ ] Is the commit message in the required format?
- [ ] Does the commit touch only logically related files?
- [ ] Are there no leftover `console.log` or debug artifacts?
- [ ] Are edge cases considered (zero RAM, negative cores, invalid input)?

---

## 6. Handling Mistakes

If a commit is made and something is wrong:
- **Small fix** → amend the commit (`git commit --amend`) if not pushed
- **Larger fix** → make a new commit with `fix(scope): ...` and reference the original commit hash in the body
- **Never** squash working history into a single commit unless explicitly asked

---

## 7. Communication

When asked to "continue" or "go further":
1. Check AGENTS.md for the next logical step in the build order
2. Execute it in one or more commits
3. Report what was done and what the next step would be

When stuck or uncertain:
- Read the existing code to understand patterns
- If the pattern is unclear, ask the user rather than guessing
- If a decision could go multiple ways, state the options concisely

---

*Last updated: Added Git Flow section with dev branch strategy*
