/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    // Brand rule: Inter at 400 and 500 only. Removing the other weights makes font-semibold/bold a build-time no-op.
    fontWeight: { normal: '400', medium: '500' },
    fontFamily: {
      sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
    },
    extend: {
      colors: {
        canvas: '#FAFAF7',
        surface: '#FFFFFF',
        line: '#E8E7E0',
        ink: { DEFAULT: '#1A1D1B', muted: '#6B6F6A' },
        brand: { DEFAULT: '#0F6E56', hover: '#085041', tint: '#EAF3F0', soft: '#D3E8E0', deep: '#0A4A3B', ink: '#062A22' },
        // Chart colours (checked together with the dataviz palette validator): invoiced teal, received bronze, expenses brick.
        chart: { invoiced: '#0B8264', received: '#B4842B', expenses: '#A63D2F' },
        gold: '#D9A94E',
        status: {
          paid: { fg: '#27500A', bg: '#EAF3DE' },
          partial: { fg: '#633806', bg: '#FAEEDA' },
          overdue: { fg: '#791F1F', bg: '#FCEBEB' },
          b2b: { fg: '#0C447C', bg: '#E6F1FB' },
          neutral: { fg: '#6B6F6A', bg: '#F0EFE9' },
        },
      },
      borderRadius: { DEFAULT: '8px', lg: '12px' },
      boxShadow: {
        overlay: '0 12px 32px -8px rgba(26, 29, 27, 0.14)',
        // Cards rest almost flat and lift a little on hover; the tint is the brand teal, not grey, so shadows feel part of the palette.
        card: '0 1px 2px rgba(6, 42, 34, 0.04)',
        lift: '0 10px 28px -14px rgba(6, 42, 34, 0.28)',
        fab: '0 10px 24px -8px rgba(6, 42, 34, 0.45)',
      },
      keyframes: {
        'fade-up': { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'none' } },
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'pop-in': { from: { opacity: '0', transform: 'translateY(8px) scale(0.985)' }, to: { opacity: '1', transform: 'none' } },
        'tick': { from: { opacity: '0.35', transform: 'translateY(3px)' }, to: { opacity: '1', transform: 'none' } },
        'fade-out': { from: { opacity: '1' }, to: { opacity: '0' } },
        'breathe': { '0%, 100%': { transform: 'scale(1)', opacity: '0.45' }, '50%': { transform: 'scale(1.55)', opacity: '0' } },
        'slide-in-right': { from: { opacity: '0', transform: 'translateX(12px)' }, to: { opacity: '1', transform: 'none' } },
        'pop-out': { from: { opacity: '1', transform: 'none' }, to: { opacity: '0', transform: 'translateY(6px) scale(0.985)' } },
      },
      animation: {
        'fade-up': 'fade-up 200ms cubic-bezier(0.2, 0.7, 0.2, 1) both',
        'fade-in': 'fade-in 160ms ease-out both',
        'pop-in': 'pop-in 180ms cubic-bezier(0.2, 0.7, 0.2, 1) both',
        'tick': 'tick 220ms ease-out both',
        'fade-out': 'fade-out 140ms ease-in both',
        'breathe': 'breathe 3.2s ease-out infinite',
        'slide-in-right': 'slide-in-right 220ms cubic-bezier(0.2, 0.7, 0.2, 1) both',
        'pop-out': 'pop-out 140ms ease-in both',
      },
    },
  },
  plugins: [],
};
