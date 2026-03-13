import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig, loadEnv } from "vite";
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

function deployEnv(): 'local' | 'preview' | 'production' {
  // Cloudflare Pages CI build (most reliable)
  if (process.env.CF_PAGES === '1') {
    return process.env.CF_PAGES_BRANCH === 'main' ? 'production' : 'preview'
  }
  // Explicit override (DEPLOY_ENV=preview npm run deploy, etc.)
  const explicit = process.env.DEPLOY_ENV
  if (explicit === 'production' || explicit === 'preview' || explicit === 'local') {
    return explicit
  }
  // npm run build / wrangler pages deploy locally - treat as production so build
  // info is never leaked to a deployed site
  if (process.env.NODE_ENV === 'production') return 'production'
  // Local dev server
  return 'local'
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, projectRoot, '')
  return {
  define: {
    APP_VERSION: JSON.stringify(packageJson.version),
    __GIT_HASH__: JSON.stringify(git.hash),
    __GIT_BRANCH__: JSON.stringify(git.branch),
    __DEPLOY_ENV__: JSON.stringify(deployEnv()),
  },
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    host: !!env.VITE_SERVER_HOST,
    allowedHosts: env.VITE_ALLOWED_HOSTS?.split(',').filter(Boolean) ?? [],
    proxy: {
      '/api': `http://localhost:${apiPort}`,
    },
  },
  resolve: {
    alias: {
      '@': resolve(projectRoot, 'src')
    }
  },
  }
});
