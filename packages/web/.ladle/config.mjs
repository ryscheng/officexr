/** @type {import('@ladle/react').UserConfig} */
export default {
  stories: 'src/**/*.stories.tsx',
  viteConfig: '.ladle/vite.config.ts',
  addons: {
    theme: { enabled: true, defaultState: 'light' },
    width: { enabled: true, defaultState: 0 },
    rtl: { enabled: false },
    ladle: { enabled: false },
  },
};
