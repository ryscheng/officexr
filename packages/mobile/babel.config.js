module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // NativeWind v4 (Tailwind for React Native)
      'nativewind/babel',
      // Resolve @officexr/core and @/* aliases without a build step.
      [
        'module-resolver',
        {
          root: ['./src'],
          alias: {
            '@': './src',
            '@officexr/core': '../../packages/core/src/index.ts',
          },
          extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
        },
      ],
    ],
  };
};
