import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/App-puntos-v2-con-Cursor/', // respeta mayúsculas/minúsculas
})