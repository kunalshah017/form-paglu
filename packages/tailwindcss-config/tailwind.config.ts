import type { Config } from 'tailwindcss';

export default {
  theme: {
    extend: {
      colors: {
        primary: '#E53E3E',
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
