import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  plugins: [{
    name: 'offline-precache',
    generateBundle(_options, bundle) {
      this.emitFile({ type: 'asset', fileName: 'precache.json', source: JSON.stringify([
        './', './index.html', './manifest.webmanifest', './icons/icon.svg', './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png',
        ...Object.keys(bundle).map(file => './' + file),
      ]) });
    },
  }],
});
