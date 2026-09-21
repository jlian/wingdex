import { createRoot, hydrateRoot } from 'react-dom/client'
import Root from './Root'

import "./main.css"
import "./lib/touch-press" // iOS-style delayed press highlight for touch

// Clean up any previously-registered service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(regs =>
    regs.forEach(r => r.unregister())
  )
}

const content = <Root />

const root = document.getElementById('app')!
if (root.dataset.prerendered) hydrateRoot(root, content)
else createRoot(root).render(content)
