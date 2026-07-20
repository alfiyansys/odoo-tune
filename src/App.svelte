<script>
  import './app.css'
  import InputForm from './app/components/InputForm.svelte'
  import { defaultInputs, runTuning } from './app/stores/tuning.js'

  let inputs = $state(defaultInputs())
  let result = $derived(runTuning(inputs))
  let activeTab = $state('postgresql')

  function handleChange(newInputs) {
    inputs = newInputs
  }
</script>

<div class="min-h-screen bg-gray-950 text-gray-100">
  <!-- Header -->
  <header class="border-b border-gray-800 bg-gray-900/50 backdrop-blur sticky top-0 z-10">
    <div class="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
      <span class="text-2xl">🛠</span>
      <h1 class="text-xl font-bold text-gray-100">OdooTune</h1>
      <span class="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">v0.1</span>
      <span class="text-sm text-gray-400 hidden sm:block ml-2">
        Optimize PostgreSQL + Odoo for your hardware
      </span>
      <a
        href="https://github.com/trustmedis/odoo-tune"
        target="_blank"
        rel="noopener"
        class="ml-auto text-gray-400 hover:text-gray-200 transition-colors"
      >
        <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 21.795 24 17.295 24 12 24 5.37 18.63 0 12 0"/></svg>
      </a>
    </div>
  </header>

  <main class="max-w-7xl mx-auto px-4 py-6">
    <div class="grid grid-cols-1 lg:grid-cols-5 gap-6">
      <!-- Form sidebar (2/5 width on desktop) -->
      <section class="lg:col-span-2 bg-gray-900 border border-gray-800 rounded-xl p-5">
        <InputForm {inputs} onChange={handleChange} />
      </section>

      <!-- Config output (3/5 width on desktop) -->
      <section class="lg:col-span-3 space-y-4">
        {#if result.ok}
          <div class="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <!-- Tabs -->
            <div class="flex border-b border-gray-800">
              <button
                class="px-4 py-3 text-sm font-medium transition-colors
                  {activeTab === 'postgresql'
                    ? 'text-indigo-400 border-b-2 border-indigo-500 bg-gray-800/50'
                    : 'text-gray-400 hover:text-gray-200'}"
                onclick={() => activeTab = 'postgresql'}
              >
                postgresql.conf
              </button>
              <button
                class="px-4 py-3 text-sm font-medium transition-colors
                  {activeTab === 'odoo'
                    ? 'text-indigo-400 border-b-2 border-indigo-500 bg-gray-800/50'
                    : 'text-gray-400 hover:text-gray-200'}"
                onclick={() => activeTab = 'odoo'}
              >
                odoo.conf
              </button>
              {#if result.data.nginxConf}
                <button
                  class="px-4 py-3 text-sm font-medium transition-colors
                    {activeTab === 'nginx'
                      ? 'text-green-400 border-b-2 border-green-500 bg-gray-800/50'
                      : 'text-gray-400 hover:text-gray-200'}"
                  onclick={() => activeTab = 'nginx'}
                >
                  <span class="flex items-center gap-1.5">
                    nginx.conf
                    <span class="text-xs bg-green-900/60 text-green-400 px-1.5 py-0.5 rounded-full">reverse proxy</span>
                  </span>
                </button>
              {/if}
              <div class="ml-auto flex items-center gap-2 px-3">
                <span class="text-xs text-gray-500">{result.data.profileName}</span>
                <button
                  onclick={() => {
                    const text = activeTab === 'postgresql'
                      ? result.data.postgresqlConf
                      : result.data.odooConf
                    navigator.clipboard.writeText(text)
                  }}
                  class="text-xs text-gray-400 hover:text-gray-200 px-2 py-1 rounded border border-gray-700 hover:border-gray-500 transition-colors"
                  aria-label="Copy to clipboard"
                >
                  📋 Copy
                </button>
              </div>
            </div>

            <!-- Config content -->
            <pre class="p-4 overflow-x-auto text-sm font-mono text-gray-300 leading-relaxed max-h-[70vh] overflow-y-auto"><code>{activeTab === 'postgresql' ? result.data.postgresqlConf : activeTab === 'nginx' ? result.data.nginxConf : result.data.odooConf}</code></pre>
          </div>

          <!-- Warnings -->
          {#if result.data.warnings.length > 0}
            <div class="bg-yellow-900/20 border border-yellow-700/40 rounded-xl p-4">
              <h3 class="text-sm font-semibold text-yellow-400 mb-2">⚠️ Warnings</h3>
              <ul class="space-y-1">
                {#each result.data.warnings as w}
                  <li class="text-sm text-yellow-300/80 flex items-start gap-2">
                    <span class="mt-0.5">•</span>
                    <span>{w}</span>
                  </li>
                {/each}
              </ul>
            </div>
          {/if}
        {:else}
          <div class="bg-gray-900 border border-gray-800 rounded-xl p-10 text-center">
            <p class="text-gray-500 text-lg mb-2">⚙️</p>
            <p class="text-gray-400">Adjust the inputs to generate your configuration</p>
          </div>
        {/if}
      </section>
    </div>
  </main>
</div>
