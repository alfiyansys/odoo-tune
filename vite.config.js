import { svelte } from '@sveltejs/vite-plugin-svelte'

/** @type {import('vite').UserConfig} */
export default {
  plugins: [svelte()],
  base: process.env.GH_PAGES ? '/odoo-tune/' : '',
  build: {
    target: 'esnext',
  },
}
