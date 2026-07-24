import { useCallback, useSyncExternalStore } from 'react'
import type { Locale } from '@/lib/i18n'
import { getTranslations } from '@/lib/i18n'

function getLocaleFromStorage(): Locale {
  if (typeof window === 'undefined') return 'en'
  return (localStorage.getItem('vesper-locale') as Locale) ?? 'en'
}

// Server snapshot MUST be a constant matching what Astro SSR/build actually
// renders (default locale 'en', per <html lang="en"> + all 'en' fallbacks).
// The inline <head> script mutates document.documentElement.dataset.locale to
// 'fr' from localStorage BEFORE hydration, so reading the DOM here caused React
// #418 hydration mismatches for fr users. Post-hydration, getSnapshot switches
// to the real value via a normal, error-free re-render.
function getServerSnapshot(): Locale {
  return 'en'
}

function subscribe(callback: () => void) {
  // 'storage' fires from other tabs; 'vesper-locale-changed' fires from same tab
  window.addEventListener('storage', callback)
  window.addEventListener('vesper-locale-changed', callback)
  return () => {
    window.removeEventListener('storage', callback)
    window.removeEventListener('vesper-locale-changed', callback)
  }
}

export function useLocale() {
  const locale = useSyncExternalStore(subscribe, getLocaleFromStorage, getServerSnapshot)

  const setLocale = useCallback((l: Locale) => {
    localStorage.setItem('vesper-locale', l)
    window.dispatchEvent(new Event('vesper-locale-changed'))
  }, [])

  const toggleLocale = useCallback(() => {
    const current = getLocaleFromStorage()
    const next = current === 'en' ? 'fr' : 'en'
    localStorage.setItem('vesper-locale', next)
    window.dispatchEvent(new Event('vesper-locale-changed'))
  }, [])

  const translations = getTranslations(locale)

  return { locale, setLocale, toggleLocale, t: translations }
}
