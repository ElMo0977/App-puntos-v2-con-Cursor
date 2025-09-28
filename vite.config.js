import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/App-puntos-v2-con-Cursor/', // EXACTO al nombre del repo
  plugins: [react()],
})