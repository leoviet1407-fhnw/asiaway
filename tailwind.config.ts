import type { Config } from 'tailwindcss';

/**
 * AsiaWay staff brand tokens. Components name these tokens, never raw colours.
 * Deep red #AC2025, navy #09141D, charcoal #3E3A38, IBM Plex Sans, 10px buttons.
 */
export default {
  content: ['./src/app/**/*.{ts,tsx}', './src/components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { 50: '#fcf1f1', 100: '#f6dcdd', 500: '#c4262c', 600: '#ac2025', 700: '#8a181c' },
        navy: { DEFAULT: '#09141d', 700: '#1a2833', 50: '#eef1f3' },
        charcoal: { DEFAULT: '#3e3a38', muted: '#6e6966' },
        surface: { DEFAULT: '#ffffff', sunken: '#f4f4f3', line: '#e3e1df' },
        ok: { 500: '#1f6b3a', 50: '#eaf5ee' },
        warn: { 500: '#8a5a00', 50: '#fdf4e3' },
        danger: { 500: '#ac2025', 50: '#fcf1f1' },
        info: { 500: '#1d4f7a', 50: '#eaf2f9' },
      },
      fontFamily: {
        sans: ['var(--font-plex-sans)', 'system-ui', 'sans-serif'],
      },
      borderRadius: { btn: '10px' },
      minHeight: { tap: '48px' },
      minWidth: { tap: '48px' },
    },
  },
  plugins: [],
} satisfies Config;
