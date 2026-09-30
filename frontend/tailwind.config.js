/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        void: { 900: '#05071a', 800: '#0a0e27', 700: '#1a1f3a', 600: '#262c52' },
        neon: {
          cyan: '#00f5ff',
          green: '#39ff14',
          magenta: '#ff00ff',
          blue: '#4169e1',
          yellow: '#ffe600',
        },
      },
      fontFamily: {
        display: ['Orbitron', 'ui-sans-serif', 'system-ui'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        'neon-cyan': '0 0 12px rgba(0,245,255,.55), inset 0 0 12px rgba(0,245,255,.15)',
        'neon-magenta': '0 0 12px rgba(255,0,255,.55), inset 0 0 12px rgba(255,0,255,.15)',
        'neon-green': '0 0 12px rgba(57,255,20,.5), inset 0 0 12px rgba(57,255,20,.12)',
      },
      keyframes: {
        flicker: {
          '0%, 19%, 21%, 23%, 25%, 54%, 56%, 100%': { opacity: '1' },
          '20%, 24%, 55%': { opacity: '0.4' },
        },
        scan: { '0%': { transform: 'translateY(-100%)' }, '100%': { transform: 'translateY(100%)' } },
        'fade-up': { '0%': { opacity: '0', transform: 'translateY(8px)' }, '100%': { opacity: '1', transform: 'none' } },
        'scan-x': { '0%': { transform: 'translateX(-100%)' }, '100%': { transform: 'translateX(100%)' } },
        blink: { '0%, 49%': { opacity: '1' }, '50%, 100%': { opacity: '0' } },
      },
      animation: {
        flicker: 'flicker 4s linear infinite',
        scan: 'scan 3s linear infinite',
        'fade-up': 'fade-up .35s ease-out both',
        blink: 'blink 1s steps(1) infinite',
        'scan-x': 'scan-x 1.2s linear infinite',
      },
    },
  },
  plugins: [],
}
