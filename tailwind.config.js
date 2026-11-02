/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Warm dark base (fire-themed, subtle)
        bg: {
          DEFAULT: '#0d0a08',
          soft: '#1a130d',
          card: '#1f1611',
          line: '#2d2018',
        },
        primary: {
          DEFAULT: '#f97316', // orange-500 (flame)
          dark: '#c2410c', // orange-700
          light: '#fb923c', // orange-400
        },
        accent: {
          DEFAULT: '#06b6d4', // cyan-500 (complementary, for fan/smoke)
          light: '#22d3ee',
        },
        safe: '#10b981',
        warning: '#f59e0b',
        danger: '#ef4444',
      },
      boxShadow: {
        glow: '0 0 24px rgba(249, 115, 22, 0.35)',
        'glow-danger': '0 0 24px rgba(239, 68, 68, 0.5)',
        'glow-safe': '0 0 18px rgba(16, 185, 129, 0.35)',
        card: '0 8px 30px rgba(0, 0, 0, 0.45)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};
