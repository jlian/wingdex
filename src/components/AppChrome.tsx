import type { ReactNode } from 'react'
import { GithubLogo } from '@phosphor-icons/react'
import { BirdLogo } from './ui/bird-logo'

export function AppHeader({ children, onHome }: { children: ReactNode; onHome?: () => void }) {
  return <>
    <header className="fixed top-0 left-0 right-0 z-40 bg-background/80 backdrop-blur-xl">
      <div className="max-w-3xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-14 sm:h-16">
          {onHome ? <button type="button" onClick={onHome}
            className="flex items-center gap-2 cursor-pointer press-feel-light" aria-label="Home">
            <BirdLogo size={32} className="text-primary" duotone />
          </button> : <a href="/" className="flex items-center gap-2 press-feel-light" aria-label="Home">
            <BirdLogo size={32} className="text-primary" duotone />
          </a>}
          {children}
        </div>
      </div>
    </header>
    <div className="h-14 sm:h-16 shrink-0" />
  </>
}

export function AppFooter({ diagnostics = '' }: { diagnostics?: string }) {
  return (
    <footer className="w-full max-w-3xl mx-auto flex flex-col-reverse items-center gap-4 px-4 sm:px-6 pt-12 pb-10 text-xs text-muted-foreground sm:flex-row sm:justify-center">
      <div className="flex items-center gap-2">
        <a href="https://github.com/jlian/wingdex/blob/main/CHANGELOG.md" target="_blank" rel="noopener noreferrer" className="press-feel-light">
          WingDex™ {typeof APP_VERSION !== 'undefined' ? APP_VERSION : 'dev'}
          {diagnostics && <span className="font-mono text-[10px]"> {diagnostics}</span>}
        </a>
        <a href="https://github.com/jlian/wingdex" target="_blank" rel="noopener noreferrer" aria-label="GitHub" className="press-feel-light"><GithubLogo size={16} /></a>
        <a href="https://johnlian.net" target="_blank" rel="noopener noreferrer" className="press-feel-light">By John Lian</a>
      </div>
      <nav className="flex items-center gap-4" aria-label="Footer">
        <a href="/#privacy" className="press-feel-light">Privacy</a>
        <a href="/#terms" className="press-feel-light">Terms</a>
        <a href="https://github.com/jlian/wingdex/issues" target="_blank" rel="noopener noreferrer" className="press-feel-light">Issues?</a>
      </nav>
    </footer>
  )
}
