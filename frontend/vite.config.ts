import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    host: '0.0.0.0'
  },
  build: {
    chunkSizeWarningLimit: 950,
    rollupOptions: {
      output: {
        manualChunks: {
          vue: ['vue', 'vue-router', 'pinia', 'axios'],
          ui: ['element-plus', '@element-plus/icons-vue'],
          visual: ['echarts', 'vue-echarts', 'leaflet']
        }
      }
    }
  }
});
