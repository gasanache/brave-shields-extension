const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
  entry: {
    'service-worker': './src/background/service-worker.ts',
    'cosmetic-observer': './src/content/cosmetic-observer.ts',
    'youtube-ad-blocker': './src/content/youtube-ad-blocker.ts',
    'popup': './src/popup/popup.ts',
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
    clean: true,
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  experiments: {
    asyncWebAssembly: true,
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        { from: 'manifest.json', to: 'manifest.json' },
        { from: 'icons', to: 'icons', noErrorOnMissing: true },
        { from: 'rulesets', to: 'rulesets', noErrorOnMissing: true },
        { from: 'cosmetic', to: 'cosmetic', noErrorOnMissing: true },
        { from: 'data', to: 'data', noErrorOnMissing: true },
        { from: 'dist/wasm', to: 'wasm', noErrorOnMissing: true },
        { from: 'src/popup/popup.css', to: 'popup.css' },
      ],
    }),
    new HtmlWebpackPlugin({
      template: './src/popup/popup.html',
      filename: 'popup.html',
      chunks: ['popup'],
    }),
  ],
  optimization: {
    minimize: false,
  },
  // Asset-size warnings are aimed at HTTP-served bundles. This is a packaged
  // browser extension — the rulesets and WASM blob are local resources, not
  // network downloads, so the budget doesn't apply.
  performance: {
    hints: false,
  },
};
