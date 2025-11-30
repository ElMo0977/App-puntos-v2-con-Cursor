# App de distribución de puntos acústicos

Aplicación React + Vite para planificar la colocación de puntos acústicos (fuentes y receptores) dentro de un recinto. Permite definir la geometría del espacio y genera combinaciones que respetan reglas geométricas y de separación mínimas.

## Instalación y ejecución

```bash
npm install        # instala dependencias
npm run dev        # levanta el entorno de desarrollo (Vite)
npm run build      # compila la app para producción
npm run deploy     # publica en GitHub Pages
```

## Uso básico

- Dibuja el recinto ajustando los vértices del polígono en planta (XY) y define la altura `Z`.
- Coloca las fuentes F1 y F2 (activas o no) y ajusta sus coordenadas.
- Pulsa "Generar puntos" para calcular posiciones válidas de los puntos azules P1..P5 según las reglas.
- Usa los controles para deshacer/rehacer, limpiar puntos y ver distancias en tablas y en el gráfico.

## Reglas geométricas (resumen)

- Todos los puntos deben quedar a ≥ 0,5 m de cada cara (incluye Z).
- Fuentes (F1, F2): separación mínima de 0,7 m en cada eje.
- Fuente–Punto: distancia 3D mínima de 1,0 m.
- Punto–Punto: distancia 3D mínima de 0,7 m.

## Créditos

Autor: Pablo R. — 2024.
