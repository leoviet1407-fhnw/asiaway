import type { Config } from 'tailwindcss';

/**
 * Asiaway brand tokens, taken from asiaway.ch.
 *
 * The site runs on three colours only — a crimson red, a near-black navy ink,
 * and white — with grey body copy, IBM Plex type and square corners. Those are
 * encoded here so the rest of the app never names a colour directly.
 */
export default {
  content: ['./src/app/**/*.{ts,tsx}', './src/components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        /* asiaway.ch accent red is #ac2025 (7.0:1 on white — AA and AAA). */
        brand: {
          50: '#fcf1f1',
          100: '#f6dcdd',
          500: '#c4262c',
          600: '#ac2025',
          700: '#8a181c',
        },
        /* The dark bands on asiaway.ch are #09141d, not a true black. */
        ink: { DEFAULT: '#09141d', muted: '#6b6b6b' },
        surface: { DEFAULT: '#ffffff', sunken: '#f1f3f4', inverse: '#09141d' },
        /* Errors sit apart from the brand red: deeper, browner, never filled. */
        danger: { 500: '#8c1c13', 50: '#fbeeec' },
        warn: { 500: '#8a5a00', 50: '#fdf4e3' },
      },
      fontFamily: {
        /* Headings use Plex Sans; body uses the Thai cut, whose Latin glyphs
           are identical — this is exactly how asiaway.ch pairs them. */
        sans: ['var(--font-plex-thai)', 'system-ui', 'sans-serif'],
        display: ['var(--font-plex-sans)', 'system-ui', 'sans-serif'],
      },
      /* asiaway.ch has no rounded corners anywhere. The scale is flattened so
         existing `rounded-xl` / `rounded-2xl` call sites inherit that. */
      borderRadius: { xl: '0px', '2xl': '0px', lg: '0px', md: '0px', DEFAULT: '0px' },
      letterSpacing: { section: '0.05em' },
      minHeight: { tap: '44px' },
      minWidth: { tap: '44px' },
    },
  },
  plugins: [],
} satisfies Config;
