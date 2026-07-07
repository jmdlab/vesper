import { useCallback } from 'react'
import type { ReactNode } from 'react'
import { BASE } from '@/lib/constants'

interface TrailingAction {
  href?: string
  onClick?: () => void
  icon: ReactNode
  label: string
}

interface NavBarProps {
  title: string
  showBack?: boolean
  titleSize?: 'small' | 'large'
  titleAlign?: 'center' | 'left'
  trailingActions?: TrailingAction[]
}

export function NavBar({ title, showBack = true, titleSize = 'small', titleAlign = 'center', trailingActions }: NavBarProps) {
  const allActions = trailingActions ?? []

  const goBack = useCallback(() => {
    if (window.history.length > 1) {
      window.history.back()
    } else {
      window.location.href = `${BASE}/home`
    }
  }, [])

  return (
    <>
      {/* Progressive blur — 6 CSS layers, strongest at top */}
      <div className="progressive-blur">
        <div />
        <div />
        <div />
        <div />
        <div />
        <div />
      </div>

      {/* Inline title */}
      <div
        className={`fixed left-0 right-0 z-40 flex items-center ${
          titleSize === 'large' ? 'justify-start px-6' :
          titleAlign === 'left' ? 'justify-start' : 'justify-center'
        }`}
        style={{
          top: titleSize === 'large'
            ? 'calc(env(safe-area-inset-top, 0px) + 6px)'
            : 'calc(env(safe-area-inset-top, 0px) + 12px)',
          height: titleSize === 'large' ? '48px' : '40px',
          pointerEvents: 'none',
          ...(titleAlign === 'left' && titleSize !== 'large' ? { paddingLeft: showBack ? '60px' : '16px' } : {}),
        }}
      >
        <span className={`truncate font-semibold text-[var(--primary)] ${
          titleSize === 'large'
            ? 'max-w-[70vw] font-[family-name:var(--font-serif)] text-2xl'
            : 'max-w-[50vw] text-sm'
        }`}>
          {title}
        </span>
      </div>

      {/* Back button — glass circle */}
      {showBack && (
        <button
          onClick={goBack}
          className="fixed z-50 flex h-10 w-10 items-center justify-center rounded-full liquid-glass text-[var(--accent)] transition-all active:scale-95"
          style={{
            top: 'calc(12px + env(safe-area-inset-top, 0px))',
            left: '16px',
          }}
          aria-label="Back"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path fillRule="evenodd" d="M11.354 1.646a.5.5 0 0 1 0 .708L5.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0" />
          </svg>
        </button>
      )}

      {/* Trailing actions — individual glass circles, stacked from right */}
      {allActions.map((action, i) => {
        const style = {
          top: 'calc(12px + env(safe-area-inset-top, 0px))',
          right: `${16 + i * 48}px`,
        }
        const cls = "fixed z-50 flex h-10 w-10 items-center justify-center rounded-full liquid-glass text-[var(--accent)] transition-all active:scale-95"
        return action.href ? (
          <a key={i} href={action.href} className={cls} style={style} aria-label={action.label}>
            {action.icon}
          </a>
        ) : (
          <button key={i} onClick={action.onClick} className={cls} style={style} aria-label={action.label}>
            {action.icon}
          </button>
        )
      })}

      {/* Spacer — clears the blur zone so content loads below it */}
      <div style={{ height: 'calc(env(safe-area-inset-top, 0px) + 80px)' }} aria-hidden="true" />
    </>
  )
}

/* Bootstrap Icons — MIT license, 16x16 viewBox */

export function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001q.044.06.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1 1 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0" />
    </svg>
  )
}

export function BookIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M1 2.828c.885-.37 2.154-.769 3.388-.893 1.33-.134 2.458.063 3.112.752v9.746c-.935-.53-2.12-.603-3.213-.493-1.18.12-2.37.461-3.287.811zm7.5-.141c.654-.689 1.782-.886 3.112-.752 1.234.124 2.503.523 3.388.893v9.923c-.918-.35-2.107-.692-3.287-.81-1.094-.111-2.278-.039-3.213.492zM8 1.783C7.015.936 5.587.81 4.287.94c-1.514.153-3.042.672-3.994 1.105A.5.5 0 0 0 0 2.5v11a.5.5 0 0 0 .707.455c.882-.4 2.303-.881 3.68-1.02 1.409-.142 2.59.087 3.223.877a.5.5 0 0 0 .78 0c.633-.79 1.814-1.019 3.222-.877 1.378.139 2.8.62 3.681 1.02A.5.5 0 0 0 16 13.5v-11a.5.5 0 0 0-.293-.455c-.952-.433-2.48-.952-3.994-1.105C10.413.809 8.985.936 8 1.783" />
    </svg>
  )
}

export function ListenIcon({ active = false }: { active?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 3a5 5 0 0 0-5 5v1h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V8a6 6 0 1 1 12 0v5a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1V8a5 5 0 0 0-5-5" />
      {active && <circle cx="8" cy="10" r="2" />}
    </svg>
  )
}
