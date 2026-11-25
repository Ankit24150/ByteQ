/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['"Plus Jakarta Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'] },
      colors: {
        brand: { 50: '#fff7ed', 100: '#ffedd5', 200: '#fed7aa', 400: '#fb923c', 500: '#f97316', 600: '#ea580c', 700: '#c2410c' },
        ink: { 900: '#1c1917', 700: '#44403c', 500: '#78716c', 300: '#d6d3d1', 100: '#f5f5f4' },
      },
      boxShadow: { card: '0 1px 2px rgba(28,25,23,.05), 0 4px 16px rgba(28,25,23,.06)' },
      keyframes: {
        pop: { '0%': { transform: 'translateY(8px)', opacity: 0 }, '100%': { transform: 'none', opacity: 1 } },
        pulseRing: { '0%,100%': { boxShadow: '0 0 0 0 rgba(239,68,68,.45)' }, '50%': { boxShadow: '0 0 0 6px rgba(239,68,68,0)' } },
      },
      animation: { pop: 'pop .25s ease-out', ring: 'pulseRing 1.6s infinite' },
    },
  },
  plugins: [],
}
