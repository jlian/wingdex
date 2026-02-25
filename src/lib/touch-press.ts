/**
 * iOS-style touch press feedback.
 *
 * On touch devices, CSS :active fires on touchstart - even during scroll
 * gestures - causing unwanted visual flashes. iOS UIKit avoids this by
 * delaying the highlighted state ~70 ms; if the finger moves (scroll) before
 * the timer fires, the highlight never shows.
 *
 * After the finger lifts the highlight lingers briefly (like iOS Messages)
 * before fading out via the CSS transition on the utility class.
 *
 * This module replicates that behavior for elements with the press-feel or
 * press-feel-subtle CSS utility class. It sets a [data-pressed] attribute
 * after a short delay and removes it on touchmove/touchcancel (immediately)
 * or touchend (after a short linger).
 *
 * Import once at app startup (side-effect only).
 */

const PRESS_DELAY_MS = 70
const LINGER_MS = 100
const SELECTOR = '.press-feel, .press-feel-subtle, .press-feel-light, .press-feel-tab'

let activeEl: Element | null = null
let timerId: ReturnType<typeof setTimeout> | null = null

function cancelTimer() {
  if (timerId !== null) {
    clearTimeout(timerId)
    timerId = null
  }
}

function onTouchStart(e: TouchEvent) {
  // Clean up any previous state
  cancelTimer()
  if (activeEl) {
    activeEl.removeAttribute('data-pressed')
    activeEl = null
  }

  const el = (e.target as Element | null)?.closest?.(SELECTOR)
  if (!el) return
  activeEl = el
  timerId = setTimeout(() => {
    if (activeEl === el) {
      el.setAttribute('data-pressed', '')
    }
    timerId = null
  }, PRESS_DELAY_MS)
}

function onTouchMove() {
  // Scroll detected - cancel everything immediately
  cancelTimer()
  if (activeEl) {
    activeEl.removeAttribute('data-pressed')
    activeEl = null
  }
}

function onTouchEnd() {
  cancelTimer()
  if (!activeEl) return
  const el = activeEl
  activeEl = null

  // If the highlight hasn't shown yet (quick tap), show it now
  if (!el.hasAttribute('data-pressed')) {
    el.setAttribute('data-pressed', '')
  }

  // Linger the highlight briefly, then remove so the CSS transition fades it
  setTimeout(() => {
    el.removeAttribute('data-pressed')
  }, LINGER_MS)
}

document.addEventListener('touchstart', onTouchStart, { passive: true })
document.addEventListener('touchmove', onTouchMove, { passive: true })
document.addEventListener('touchend', onTouchEnd, { passive: true })
document.addEventListener('touchcancel', onTouchMove, { passive: true })
