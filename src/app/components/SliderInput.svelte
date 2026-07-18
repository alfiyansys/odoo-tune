<script>
  /**
   * Slider with inline number input.
   * Provides both drag-to-adjust and type-to-set functionality.
   */
  let {
    label,
    value,
    min = 0,
    max = 100,
    step = 1,
    unit = '',
    accent = 'indigo',
    onchange,
  } = $props()

  let inputValue = $state(String(value))

  // Sync internal input when slider moves from outside
  $effect(() => {
    inputValue = String(value)
  })

  function handleSlider(e) {
    const v = parseFloat(e.target.value)
    inputValue = String(v)
    onchange(v)
  }

  function handleInput(e) {
    inputValue = e.target.value
  }

  function handleBlur() {
    let v = parseFloat(inputValue)
    if (isNaN(v)) {
      inputValue = String(value)
      return
    }
    v = Math.min(max, Math.max(min, v))
    inputValue = String(v)
    onchange(v)
  }

  function handleKeydown(e) {
    if (e.key === 'Enter') {
      e.target.blur()
    }
  }
</script>

<div>
  <div class="flex items-center justify-between mb-1">
    <label class="text-sm font-medium text-gray-200" for="slider-{label}">{label}</label>
    <div class="flex items-center gap-1">
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={inputValue}
        oninput={handleInput}
        onblur={handleBlur}
        onkeydown={handleKeydown}
        class="w-16 px-1.5 py-0.5 text-right text-sm font-mono bg-gray-800 border border-gray-700 rounded
          focus:ring-1 focus:ring-{accent}-500 focus:border-{accent}-500 text-gray-100"
      />
      {#if unit}
        <span class="text-xs text-gray-400 w-6">{unit}</span>
      {/if}
    </div>
  </div>
  <input
    id="slider-{label}"
    type="range"
    {min}
    {max}
    {step}
    value={value}
    oninput={handleSlider}
    class="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-{accent}-500"
  />
  <div class="flex justify-between text-xs text-gray-500 mt-0.5">
    <span>{min}{unit}</span>
    <span>{max}{unit}</span>
  </div>
</div>
