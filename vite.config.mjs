import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // IMPORTANTE: debe coincidir EXACTAMENTE con el nombre del repositorio de GitHub Pages
  // Tu enlace es https://elmo0977.github.io/App-puntos-v2-con-Cursor/
  // por tanto el `base` correcto es:
  base: process.env.VITE_BASE_PATH || '/App-puntos-v2-con-Cursor/',
})
