<script>
  import { getProfileNames, getProfileDescription } from '../stores/tuning.js'

  let {
    inputs,
    onChange,
  } = $props()

  import SliderInput from './SliderInput.svelte'

  const profileNames = getProfileNames()

  function handleInput(field, value) {
    onChange({ ...inputs, [field]: value })
  }

  // OS reserve: default auto (calculated) or manual GB
  let osReserveManual = $state(false)
  let osReserveGB = $state(3)

  function handleOsReserveToggle() {
    osReserveManual = !osReserveManual
    if (!osReserveManual) {
      handleInput('osReserveGB', undefined)
    } else {
      handleInput('osReserveGB', osReserveGB)
    }
  }

  function handleOsReserveChange(val) {
    osReserveGB = val
    handleInput('osReserveGB', val)
  }

  const diskTypes = [
    { value: 'nvme', label: 'NVMe' },
    { value: 'ssd', label: 'SSD' },
    { value: 'cloud', label: 'Cloud (SSD-backed)' },
    { value: 'hdd', label: 'HDD' },
  ]

  const dbSizes = [
    { value: 'small', label: 'Small (<10 GB)' },
    { value: 'medium', label: 'Medium (10-100 GB)' },
    { value: 'large', label: 'Large (100-500 GB)' },
    { value: 'very-large', label: 'Very Large (>500 GB)' },
  ]

  const poolTypes = [
    { value: 'transaction', label: 'Transaction (recommended)' },
    { value: 'session', label: 'Session' },
    { value: 'none', label: 'None (direct connections)' },
  ]

  const odooVersions = [17, 18, 19]

  const pgVersions = [
    { value: 14, label: 'PostgreSQL 14' },
    { value: 15, label: 'PostgreSQL 15' },
    { value: 16, label: 'PostgreSQL 16' },
    { value: 17, label: 'PostgreSQL 17' },
  ]

  const deployments = [
    { value: 'same', label: 'Same machine (Odoo + PostgreSQL)' },
    { value: 'separate', label: 'Separate dedicated servers' },
  ]
</script>

<div class="space-y-5">
  <!-- Header -->
  <div>
    <h2 class="text-lg font-semibold text-gray-100">System Specs</h2>
    <p class="text-sm text-gray-400">Your PostgreSQL host hardware</p>
  </div>

  <!-- RAM Slider -->
  <SliderInput
    label="Total RAM"
    value={inputs.totalRAMGB}
    min={1}
    max={256}
    step={1}
    unit="GB"
    onchange={(v) => handleInput('totalRAMGB', v)}
  />

  <!-- OS Reserve -->
  <div class="bg-gray-800/50 rounded-lg p-3 border border-gray-700/50">
    <div class="flex items-center justify-between">
      <label class="text-sm font-medium text-gray-200" for="os-reserve">
        OS &amp; System Reserve
      </label>
      <button
        onclick={handleOsReserveToggle}
        class="text-xs px-2 py-1 rounded border transition-colors
          {osReserveManual
            ? 'bg-indigo-900/50 border-indigo-600 text-indigo-300'
            : 'bg-gray-800 border-gray-600 text-gray-400 hover:border-gray-500'}"
      >
        {osReserveManual ? 'Manual' : 'Auto'}
      </button>
    </div>

    {#if osReserveManual}
      <div class="mt-2">
        <SliderInput
          label="OS Reserve"
          value={osReserveGB}
          min={0.5}
          max={32}
          step={0.5}
          unit="GB"
          accent="amber"
          onchange={handleOsReserveChange}
        />
        <p class="text-xs text-amber-400/70 mt-1">Reserved for OS + other services</p>
      </div>
    {:else}
      <p class="text-xs text-gray-400 mt-1">
        Auto-calculated: ~10% of total RAM (min 1 GB) for OS kernel, caches, and other services
      </p>
    {/if}
  </div>

  <!-- CPU Cores Slider -->
  <SliderInput
    label="CPU Cores"
    value={inputs.totalCPUCores}
    min={1}
    max={64}
    step={1}
    unit="cores"
    onchange={(v) => handleInput('totalCPUCores', v)}
  />

  <!-- Disk Type -->
  <div>
    <label class="block text-sm font-medium text-gray-200" for="disk">Disk Type</label>
    <select
      id="disk"
      value={inputs.diskType}
      onchange={(e) => handleInput('diskType', e.target.value)}
      class="w-full mt-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
    >
      {#each diskTypes as dt}
        <option value={dt.value}>{dt.label}</option>
      {/each}
    </select>
  </div>

  <!-- Separator -->
  <hr class="border-gray-700" />

  <!-- Odoo Deployment -->
  <div>
    <h2 class="text-lg font-semibold text-gray-100">Odoo Deployment</h2>
    <p class="text-sm text-gray-400">Your user load and database size</p>
  </div>

  <!-- Users -->
  <SliderInput
    label="Concurrent Users"
    value={inputs.users}
    min={1}
    max={500}
    step={1}
    unit="users"
    onchange={(v) => handleInput('users', v)}
  />

  <!-- Odoo Version -->
  <div>
    <label class="block text-sm font-medium text-gray-200" for="version">Odoo Version</label>
    <select
      id="version"
      value={inputs.odooVersion}
      onchange={(e) => handleInput('odooVersion', parseInt(e.target.value))}
      class="w-full mt-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
    >
      {#each odooVersions as v}
        <option value={v}>v{v}</option>
      {/each}
    </select>
  </div>

  <!-- PostgreSQL Version -->
  <div>
    <label class="block text-sm font-medium text-gray-200" for="pgversion">PostgreSQL Version</label>
    <select
      id="pgversion"
      value={inputs.pgVersion}
      onchange={(e) => handleInput('pgVersion', parseInt(e.target.value))}
      class="w-full mt-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
    >
      {#each pgVersions as v}
        <option value={v.value}>{v.label}</option>
      {/each}
    </select>
  </div>

  <!-- DB Size -->
  <div>
    <label class="block text-sm font-medium text-gray-200" for="dbsize">Database Size</label>
    <select
      id="dbsize"
      value={inputs.dbSize}
      onchange={(e) => handleInput('dbSize', e.target.value)}
      class="w-full mt-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
    >
      {#each dbSizes as s}
        <option value={s.value}>{s.label}</option>
      {/each}
    </select>
  </div>

  <!-- Deployment Mode -->
  <div>
    <label class="block text-sm font-medium text-gray-200" for="deploy">Deployment Mode</label>
    <select
      id="deploy"
      value={inputs.deployment}
      onchange={(e) => handleInput('deployment', e.target.value)}
      class="w-full mt-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
    >
      {#each deployments as d}
        <option value={d.value}>{d.label}</option>
      {/each}
    </select>
    <p class="text-xs text-gray-400 mt-1">
      {inputs.deployment === 'same'
        ? 'RAM split: 65% PostgreSQL, 35% Odoo, 10% OS reserve'
        : 'Each service gets full machine resources'}
    </p>
  </div>

  <!-- Connection Pooling -->
  <div>
    <label class="block text-sm font-medium text-gray-200" for="pool">Connection Pooling</label>
    <select
      id="pool"
      value={inputs.connPool}
      onchange={(e) => handleInput('connPool', e.target.value)}
      class="w-full mt-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
    >
      {#each poolTypes as p}
        <option value={p.value}>{p.label}</option>
      {/each}
    </select>
  </div>

  <!-- Profile -->
  <div>
    <label class="block text-sm font-medium text-gray-200" for="profile">Tuning Profile</label>
    <select
      id="profile"
      value={inputs.profile}
      onchange={(e) => handleInput('profile', e.target.value)}
      class="w-full mt-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
    >
      {#each profileNames as p}
        <option value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
      {/each}
    </select>
    <p class="text-xs text-gray-400 mt-1">{getProfileDescription(inputs.profile)}</p>
  </div>

  <!-- Toggles -->
  <div class="space-y-3 pt-2">
    <label class="flex items-center gap-3 cursor-pointer">
      <input
        type="checkbox"
        checked={inputs.multiCompany}
        onchange={(e) => handleInput('multiCompany', e.target.checked)}
        class="w-4 h-4 rounded bg-gray-800 border-gray-600 accent-indigo-500"
      />
      <span class="text-sm text-gray-200">Multi-company</span>
    </label>
    <label class="flex items-center gap-3 cursor-pointer">
      <input
        type="checkbox"
        checked={inputs.batchHeavy}
        onchange={(e) => handleInput('batchHeavy', e.target.checked)}
        class="w-4 h-4 rounded bg-gray-800 border-gray-600 accent-indigo-500"
      />
      <span class="text-sm text-gray-200">Batch-heavy (imports, mass updates)</span>
    </label>
  </div>
</div>
