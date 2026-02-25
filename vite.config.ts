import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";
import { resolve } from 'path'
import { execSync } from 'child_process'
import packageJson from './package.json'

const projectRoot = process.env.PROJECT_ROOT || import.meta.dirname
const apiPort = process.env.API_PORT || '8788'

function gitInfo() {
  try {
    const hash = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim()
    const branch = execSync('git branch --show-current', { encoding: 'utf-8' }).trim()
    return { hash, branch }
  } catch {
    return { hash: '', branch: '' }
  }
}

const git = gitInfo()

// https://vite.dev/config/
export default defineConfig({
  define: {
    APP_VERSION: JSON.stringify(packageJson.version),
    __GIT_HASH__: JSON.stringify(git.hash),
    __GIT_BRANCH__: JSON.stringify(git.branch),
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
