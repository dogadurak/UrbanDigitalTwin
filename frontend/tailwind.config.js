/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
        display: ['Outfit', 'Inter', 'sans-serif'],
      },
      colors: {
        cyber: {
          dark: '#05050A',
          darker: '#020205',
          cyan: '#00E5FF',
          blue: '#0066FF',
          purple: '#9D00FF',
          magenta: '#FF00FF',
          green: '#00FF66',
          red: '#FF003C',
          warning: '#FFB800',
        }
      },
      boxShadow: {
        'neon-cyan': '0 0 5px theme("colors.cyber.cyan"), 0 0 20px theme("colors.cyber.cyan")',
        'neon-purple': '0 0 5px theme("colors.cyber.purple"), 0 0 20px theme("colors.cyber.purple")',
        'neon-magenta': '0 0 5px theme("colors.cyber.magenta"), 0 0 20px theme("colors.cyber.magenta")',
        'neon-red': '0 0 5px theme("colors.cyber.red"), 0 0 20px theme("colors.cyber.red")',
        'glass': 'inset 0 1px 0 0 rgba(255, 255, 255, 0.1)',
        'glass-strong': 'inset 0 1px 0 0 rgba(255, 255, 255, 0.2), 0 8px 32px 0 rgba(0, 0, 0, 0.5)',
      },
      backgroundImage: {
        'glass-gradient': 'linear-gradient(135deg, rgba(255, 255, 255, 0.05) 0%, rgba(255, 255, 255, 0.01) 100%)',
        'cyber-gradient': 'linear-gradient(to right, #00E5FF, #0066FF)',
        'alert-gradient': 'linear-gradient(to right, #FF003C, #FFB800)',
      },
      animation: {
        'scanline': 'scan 8s linear infinite',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'float': 'float 6s ease-in-out infinite',
      },
      keyframes: {
        scan: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100%)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        }
      }
    },
  },
  plugins: [],
}
