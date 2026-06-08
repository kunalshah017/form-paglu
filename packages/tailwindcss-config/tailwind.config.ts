import type { Config } from 'tailwindcss';

export default {
  theme: {
    extend: {
      colors: {
        primary: '#49B6E5',
        secondary: '#263D5B',
        success: '#16A34A',
        warning: '#D97706',
        danger: '#DC2626',
        surface: '#FFFFFF',
      },
      fontFamily: {
        doodle: ['Delius Swash Caps', 'cursive'],
      },
    },
  },
  plugins: [],
} as Omit<Config, 'content'>;
