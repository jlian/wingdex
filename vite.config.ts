import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";
import { resolve } from 'path'
import packageJson from './package.json'

const projectRoot = process.env.PROJECT_ROOT || import.meta.dirname
const apiPort = process.env.API_PORT || '8788'

// https://vite.dev/config/
export default defineConfig({
  define: {
    APP_VERSION: JSON.stringify(packageJson.version),
  },
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    proxy: {
      '/api': `http://localhost:${apiPort}`,
    },
  },
  resolve: {
    alias: {
      '@': resolve(projectRoot, 'src')
    }
  },
});
