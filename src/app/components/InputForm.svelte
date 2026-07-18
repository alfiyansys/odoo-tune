<script>
  import { getProfileNames, getProfileDescription } from '../stores/tuning.js'

  let {
    inputs,
    onChange,
  } = $props()

  const profileNames = getProfileNames()

  function handleInput(field, value) {
    onChange({ ...inputs, [field]: value })
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
</script>

<div class="space-y-5">
  <!-- Header -->
  <div>
    <h2 class="text-lg font-semibold text-gray-100">System Specs</h2>
    <p class="text-sm text-gray-400">Your PostgreSQL host hardware</p>
  </div>

  <!-- RAM Slider -->
  <div>
    <label class="flex justify-between text-sm font-medium text-gray-200" for="ram">
      <span>RAM</span>
      <span class="text-indigo-400 font-mono">{inputs.totalRamGB} GB</span>
    </label>
    <input
      id="ram"
      type="range"
      min="1"
      max="256"
      step="1"
      value={inputs.totalRamGB}
      oninput={(e) => handleInput('totalRamGB', parseInt(e.target.value))}
      class="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-indigo-500 mt-1"
    />
    <div class="flex justify-between text-xs text-gray-500 mt-0.5">
      <span>1 GB</span>
      <span>256 GB</span>
    </div>
  </div>

  <!-- CPU Cores Slider -->
  <div>
    <label class="flex justify-between text-sm font-medium text-gray-200" for="cpu">
      <span>CPU Cores</span>
      <span class="text-indigo-400 font-mono">{inputs.cpuCores} cores</span>
    </label>
    <input
      id="cpu"
      type="range"
      min="1"
      max="64"
      step="1"
      value={inputs.cpuCores}
      oninput={(e) => handleInput('cpuCores', parseInt(e.target.value))}
      class="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-indigo-500 mt-1"
    />
    <div class="flex justify-between text-xs text-gray-500 mt-0.5">
      <span>1 core</span>
      <span>64 cores</span>
    </div>
  </div>

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
  <div>
    <label class="flex justify-between text-sm font-medium text-gray-200" for="users">
      <span>Concurrent Users</span>
      <span class="text-indigo-400 font-mono">{inputs.users}</span>
    </label>
    <input
      id="users"
      type="range"
      min="1"
      max="500"
      step="1"
      value={inputs.users}
      oninput={(e) => handleInput('users', parseInt(e.target.value))}
      class="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-indigo-500 mt-1"
    />
    <div class="flex justify-between text-xs text-gray-500 mt-0.5">
      <span>1</span>
      <span>500</span>
    </div>
  </div>

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
