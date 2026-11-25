import React, { createContext, useCallback, useContext, useState } from 'react'
import { AlertTriangle, CheckCircle2, Inbox, Loader2, XCircle } from 'lucide-react'
import { imgUrl } from '../api.js'

/* ---------- Toasts ---------- */
const ToastCtx = createContext(() => {})
export const useToast = () => useContext(ToastCtx)
export function ToastProvider({ children }) {
  const [items, setItems] = useState([])
  const push = useCallback((message, type = 'success') => {
    const id = Math.random()
    setItems((i) => [...i, { id, message, type }])
    setTimeout(() => setItems((i) => i.filter((x) => x.id !== id)), 4200)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed top-20 right-4 z-[100] flex flex-col gap-2 w-[calc(100%-2rem)] max-w-sm" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`animate-pop flex items-start gap-2 rounded-xl px-4 py-3 text-sm font-semibold shadow-lg text-white ${t.type === 'error' ? 'bg-red-600' : 'bg-emerald-600'}`}>
            {t.type === 'error' ? <XCircle size={18} className="shrink-0 mt-0.5" /> : <CheckCircle2 size={18} className="shrink-0 mt-0.5" />}
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

/* ---------- States ---------- */
export const Spinner = ({ label = 'Loading…' }) => (
  <div className="flex items-center justify-center gap-2 py-16 text-ink-500 text-sm font-medium">
    <Loader2 className="animate-spin" size={18} /> {label}
  </div>
)
export const Empty = ({ icon: Icon = Inbox, title, hint }) => (
  <div className="flex flex-col items-center text-center py-12 text-ink-500">
    <Icon size={36} className="mb-2 text-ink-300" />
    <p className="font-semibold text-ink-700">{title}</p>
    {hint && <p className="text-sm mt-1">{hint}</p>}
  </div>
)
export const ErrorState = ({ error, retry }) => (
  <div className="card p-6 text-center border-red-200">
    <AlertTriangle className="mx-auto text-red-500 mb-2" />
    <p className="font-semibold text-red-700">{error?.message || 'Something went wrong'}</p>
    {retry && <button className="btn-ghost mt-3" onClick={retry}>Try again</button>}
  </div>
)

/* ---------- Status ---------- */
export const STATUS_STYLE = {
  Pending: 'bg-amber-100 text-amber-800',
  Accepted: 'bg-sky-100 text-sky-800',
  Preparing: 'bg-orange-100 text-orange-800',
  'Ready for Pickup': 'bg-emerald-100 text-emerald-800',
  Completed: 'bg-stone-200 text-stone-700',
  Cancelled: 'bg-red-100 text-red-700',
}
export const StatusBadge = ({ status }) => (
  <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${STATUS_STYLE[status] || 'bg-ink-100'}`}>{status}</span>
)

/* ---------- Food image ---------- */
export const FoodImg = ({ src, alt, className = '' }) => (
  <img src={imgUrl(src)} alt={alt} loading="lazy" className={`object-cover bg-brand-50 ${className}`} />
)

/* ---------- Slot status colours ---------- */
export const SLOT_COLOR = {
  Available: { bar: 'bg-emerald-500', text: 'text-emerald-700', pill: 'bg-emerald-100 text-emerald-800' },
  'Filling Fast': { bar: 'bg-amber-500', text: 'text-amber-700', pill: 'bg-amber-100 text-amber-800' },
  Full: { bar: 'bg-red-500', text: 'text-red-700', pill: 'bg-red-100 text-red-700' },
  Closed: { bar: 'bg-stone-400', text: 'text-stone-500', pill: 'bg-stone-200 text-stone-600' },
}

/** LIVE QUEUE METER - one row per pickup slot with occupancy bar and status. */
export function QueueMeter({ slots, compact = false }) {
  return (
    <div className={`grid gap-2 ${compact ? 'sm:grid-cols-2 xl:grid-cols-4' : 'sm:grid-cols-2 lg:grid-cols-4'}`}>
      {slots.map((s) => {
        const c = SLOT_COLOR[s.status] || SLOT_COLOR.Available
        return (
          <div key={s.id} className="rounded-xl border border-ink-100 bg-white px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-ink-700">{s.label}</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${c.pill}`}>{s.status}</span>
            </div>
            <div className="mt-1.5 h-2 rounded-full bg-ink-100 overflow-hidden">
              <div className={`h-full ${c.bar} transition-all duration-500`} style={{ width: `${Math.min(s.occupancy_pct, 100)}%` }} />
            </div>
            <div className="mt-1 flex justify-between text-[11px] text-ink-500 font-medium">
              <span>{s.booked_count} / {s.capacity} orders</span>
              <span>{s.remaining} free</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export const SourceBadge = ({ live }) => (
  <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${live ? 'bg-emerald-100 text-emerald-800' : 'bg-indigo-100 text-indigo-800'}`}>
    <span className={`h-2 w-2 rounded-full ${live ? 'bg-emerald-500 animate-pulse' : 'bg-indigo-500'}`} />
    {live ? 'LIVE · orders placed in this app' : 'HISTORICAL · imported 30-day dataset'}
  </span>
)
