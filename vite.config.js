import { svelte } from '@sveltejs/vite-plugin-svelte'

/** @type {import('vite').UserConfig} */
export default {
  plugins: [svelte()],
  base: '/odoo-tune/',
  build: {
    target: 'esnext',
  },
}
