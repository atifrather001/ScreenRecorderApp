/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/**/*.{html,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        accent: { 400: '#5eead4', 500: '#14b8a6', 600: '#0d9488', 700: '#0f766e' },
        ink: { 950: '#0b0d12', 900: '#11141b', 850: '#161a23', 800: '#1c2130', 700: '#272e40', 600: '#363f56', 500: '#56607a', 400: '#8a93ab', 300: '#b9c0d3', 200: '#dde1ea' },
      },
      fontFamily: { sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Inter', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [],
};
