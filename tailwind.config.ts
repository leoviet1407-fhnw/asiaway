import type { Config } from 'tailwindcss';

/**
 * Branding is not yet supplied, so colours live here as tokens rather than
 * scattered through components. When Asiaway provides its palette, this file
 * changes and nothing else does.
 */
export default {
  content: ['./src/app/**/*.{ts,tsx}', './src/components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f3f7f4',
          100: '#e2ece5',
          500: '#3f7d58',
          600: '#336548',
          700: '#274f38',
        },
        ink: { DEFAULT: '#1b1b1a', muted: '#5c5c58' },
        surface: { DEFAULT: '#ffffff', sunken: '#f6f5f2' },
        danger: { 500: '#b3261e', 50: '#fdecea' },
        warn: { 500: '#9a6700', 50: '#fff8e5' },
      },
      minHeight: { tap: '44px' },
      minWidth: { tap: '44px' },
    },
  },
  plugins: [],
} satisfies Config;
