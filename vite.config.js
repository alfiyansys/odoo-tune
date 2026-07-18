import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwind from '@tailwindcss/vite'

/** @type {import('vite').UserConfig} */
export default {
  plugins: [tailwind(), svelte()],
  build: {
    target: 'esnext',
  },
}
