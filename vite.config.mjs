import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // IMPORTANTE: debe coincidir EXACTAMENTE con el nombre del repositorio de GitHub Pages
  // Si tu repo se llama "1-App-puntos-v2-con-Cursor", el base debe ser "/1-App-puntos-v2-con-Cursor/"
  // Cambia esta línea si tu repo tiene otro nombre.
  base: '/1-App-puntos-v2-con-Cursor/',
})
