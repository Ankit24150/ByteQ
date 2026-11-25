import React, { useEffect, useRef, useState } from 'react'
import { AlarmClock, Bell, CheckCheck, ChefHat, Flame, PackageCheck, Play, ToggleLeft, ToggleRight, XCircle } from 'lucide-react'
import { api, rupee, useApi } from '../api.js'
import { Empty, ErrorState, FoodImg, QueueMeter, Spinner, StatusBadge, useToast } from '../components/ui.jsx'

const NEXT = {
  Pending: { to: 'Accepted', label: 'Accept', icon: CheckCheck },
  Accepted: { to: 'Preparing', label: 'Start preparing', icon: Play },
  Preparing: { to: 'Ready for Pickup', label: 'Mark ready', icon: PackageCheck },
  'Ready for Pickup': { to: 'Completed', label: 'Handed over', icon: CheckCheck },
}

export default function Kitchen() {
  const toast = useToast()
  const orders = useApi('/api/orders', { poll: 3000 })
  const prep = useApi('/api/kitchen/prep-summary', { poll: 3000 })
  const slots = useApi('/api/slots', { poll: 5000 })
  const menu = useApi('/api/menu')
  const [showDone, setShowDone] = useState(false)
  const seen = useRef(null)

  // Notify staff when a new order arrives
  useEffect(() => {
    if (!orders.data) return
    const ids = new Set(orders.data.map((o) => o.order_id))
    if (seen.current) {
      const fresh = orders.data.filter((o) => !seen.current.has(o.order_id))
      if (fresh.length) toast(`🔔 ${fresh.length} new order${fresh.length > 1 ? 's' : ''}: ${fresh.map((f) => f.order_id).join(', ')}`)
    }
    seen.current = ids
  }, [orders.data])

  async function setStatus(o, status) {
    if (status === 'Cancelled' && !confirm(`Cancel ${o.order_id}? The pickup slot will be released.`)) return
    try {
      await api(`/api/orders/${o.order_id}/status`, { method: 'PATCH', body: { status } })
      toast(`${o.order_id} → ${status}`)
      orders.reload(); prep.reload(); slots.reload()
    } catch (e) { toast(e.message, 'error'); orders.reload() }
  }
  async function toggle(item) {
    try { await api(`/api/menu/${item.id}`, { method: 'PATCH', body: { availability: !item.available } }); menu.reload(); toast(`${item.name} marked ${item.available ? 'sold out' : 'available'}`) }
    catch (e) { toast(e.message, 'error') }
  }

  if (orders.loading && !orders.data) return <Spinner label="Loading kitchen…" />
  if (orders.error && !orders.data) return <ErrorState error={orders.error} retry={orders.reload} />

  const all = orders.data || []
  const by = (...st) => all.filter((o) => st.includes(o.status))
  const incoming = by('Pending'), cooking = by('Accepted', 'Preparing'), ready = by('Ready for Pickup'), done = by('Completed', 'Cancelled')
  const counts = prep.data?.status_counts || {}

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold flex items-center gap-2"><ChefHat className="text-brand-500" /> Kitchen dashboard</h1>
          <p className="text-sm text-ink-500 flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" /> Live · refreshes every 3 seconds · sorted by pickup time</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {[['Pending', 'bg-amber-100 text-amber-800'], ['Preparing', 'bg-orange-100 text-orange-800'], ['Ready for Pickup', 'bg-emerald-100 text-emerald-800'], ['Completed', 'bg-stone-200 text-stone-700']].map(([s, c]) => (
            <div key={s} className={`rounded-xl px-3 py-1.5 text-center ${c}`}><p className="text-xl font-extrabold leading-none">{counts[s] ?? 0}</p><p className="text-[10px] font-bold uppercase">{s === 'Ready for Pickup' ? 'Ready' : s}</p></div>
          ))}
        </div>
      </div>

      {/* What to cook */}
      <section className="card p-5">
        <h2 className="font-extrabold flex items-center gap-2 mb-3"><Flame className="text-brand-500" size={18} /> Total to prepare now <span className="text-xs font-semibold text-ink-500">(Pending + Accepted + Preparing)</span></h2>
        {prep.data?.items?.length ? (
          <div className="flex flex-wrap gap-3">
            {prep.data.items.map((i) => (
              <div key={i.name} className="flex items-center gap-3 rounded-2xl bg-brand-50 border border-brand-100 pr-4">
                <FoodImg src={i.image} alt="" className="h-14 w-14 rounded-l-2xl" />
                <div><p className="text-sm font-bold leading-tight">{i.name}</p><p className="text-[11px] text-ink-500">first pickup {i.next_pickup}</p></div>
                <span className="text-3xl font-extrabold text-brand-600 ml-1">×{i.quantity}</span>
              </div>
            ))}
          </div>
        ) : <Empty icon={ChefHat} title="Nothing to prepare" hint="New orders will show up here instantly." />}
      </section>

      {/* Board */}
      <div className="grid lg:grid-cols-3 gap-4 items-start">
        <Column title="Incoming orders" icon={Bell} count={incoming.length} tone="amber">
          {incoming.length === 0 ? <Empty title="No new orders" /> : incoming.map((o) => <OrderCard key={o.order_id} o={o} onStatus={setStatus} />)}
        </Column>
        <Column title="Cooking queue" icon={Flame} count={cooking.length} tone="orange" hint="Cook in this order (earliest pickup first)">
          {cooking.length === 0 ? <Empty title="Queue is empty" hint="Accept an incoming order to start cooking." /> : cooking.map((o, i) => <OrderCard key={o.order_id} o={o} pos={i + 1} onStatus={setStatus} />)}
        </Column>
        <Column title="Ready for pickup" icon={PackageCheck} count={ready.length} tone="emerald">
          {ready.length === 0 ? <Empty title="Nothing waiting" /> : ready.map((o) => <OrderCard key={o.order_id} o={o} onStatus={setStatus} />)}
        </Column>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <section className="card p-5">
          <h2 className="font-extrabold mb-3">Pickup slot load</h2>
          {slots.data ? <QueueMeter compact slots={slots.data.slots} /> : <Spinner />}
        </section>
        <section className="card p-5">
          <h2 className="font-extrabold mb-1">Menu availability</h2>
          <p className="text-xs text-ink-500 mb-3">Mark an item sold out and students can no longer order it.</p>
          <div className="grid sm:grid-cols-2 gap-1.5 max-h-64 overflow-y-auto">
            {(menu.data || []).map((i) => (
              <button key={i.id} onClick={() => toggle(i)} className="flex items-center justify-between rounded-lg px-3 py-1.5 text-sm hover:bg-ink-100 text-left">
                <span className={`font-semibold ${i.available ? '' : 'line-through text-ink-500'}`}>{i.name}</span>
                {i.available ? <ToggleRight className="text-emerald-500" /> : <ToggleLeft className="text-ink-300" />}
              </button>
            ))}
          </div>
        </section>
      </div>

      <section>
        <button className="btn-ghost" onClick={() => setShowDone(!showDone)}>{showDone ? 'Hide' : 'Show'} completed & cancelled ({done.length})</button>
        {showDone && (done.length === 0 ? <Empty title="Nothing finished yet" /> : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-3">{done.map((o) => <OrderCard key={o.order_id} o={o} onStatus={setStatus} />)}</div>
        ))}
      </section>
    </div>
  )
}

function Column({ title, icon: Icon, count, tone, hint, children }) {
  const bg = { amber: 'bg-amber-50', orange: 'bg-orange-50', emerald: 'bg-emerald-50' }[tone]
  return (
    <section className={`rounded-2xl ${bg} p-3`}>
      <div className="flex items-center justify-between px-1 mb-1">
        <h2 className="font-extrabold flex items-center gap-2"><Icon size={17} /> {title}</h2>
        <span className="rounded-full bg-white px-2.5 py-0.5 text-sm font-extrabold">{count}</span>
      </div>
      {hint && <p className="text-xs text-ink-500 px-1 mb-2">{hint}</p>}
      <div className="space-y-3 mt-2">{children}</div>
    </section>
  )
}

function OrderCard({ o, pos, onStatus }) {
  const next = NEXT[o.status]
  const hot = o.urgency === 'urgent' || o.urgency === 'overdue'
  return (
    <article className={`card p-4 animate-pop ${hot ? 'ring-2 ring-red-500 animate-ring' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {pos && <span className="grid place-items-center h-7 w-7 shrink-0 rounded-full bg-brand-500 text-white text-sm font-extrabold">{pos}</span>}
          <div className="min-w-0">
            <p className="font-extrabold tracking-wide text-sm truncate">{o.order_id}</p>
            <p className="text-xs text-ink-500 truncate">{o.customer_name}</p>
          </div>
        </div>
        <StatusBadge status={o.status} />
      </div>
      <div className="mt-2 flex items-center gap-2 flex-wrap">
        <span className="inline-flex items-center gap-1 rounded-lg bg-ink-900 px-2 py-1 text-xs font-bold text-white"><AlarmClock size={12} /> Pickup {o.pickup_slot.label}</span>
        {o.urgency === 'urgent' && <span className="rounded-lg bg-red-100 px-2 py-1 text-xs font-bold text-red-700">⚡ Due soon</span>}
        {o.urgency === 'overdue' && <span className="rounded-lg bg-red-600 px-2 py-1 text-xs font-bold text-white">Overdue</span>}
      </div>
      <ul className="mt-3 space-y-1">
        {o.items.map((i) => (
          <li key={i.menu_item_id} className="flex justify-between text-sm"><span className="font-semibold">{i.name}</span><span className="font-extrabold">× {i.quantity}</span></li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-ink-500">{o.total_quantity} item{o.total_quantity === 1 ? '' : 's'} · {rupee(o.total_amount)}</p>
      {(next || !['Completed', 'Cancelled'].includes(o.status)) && (
        <div className="mt-3 flex gap-2">
          {next && (() => {
            const btnColor =
              next.to === 'Accepted' ? 'btn bg-sky-500 text-white hover:bg-sky-600 shadow-sm flex-1 !py-2'
              : next.to === 'Preparing' ? 'btn bg-amber-500 text-white hover:bg-amber-600 shadow-sm flex-1 !py-2'
              : next.to === 'Ready for Pickup' ? 'btn bg-emerald-500 text-white hover:bg-emerald-600 shadow-sm flex-1 !py-2 ring-2 ring-emerald-300'
              : next.to === 'Completed' ? 'btn bg-stone-600 text-white hover:bg-stone-700 shadow-sm flex-1 !py-2'
              : 'btn-primary flex-1 !py-2'
            return <button className={btnColor} onClick={() => onStatus(o, next.to)}><next.icon size={15} /> {next.label}</button>
          })()}
          {!['Completed', 'Cancelled'].includes(o.status) && <button className="btn-danger !px-3 !py-2" onClick={() => onStatus(o, 'Cancelled')} aria-label="Cancel order"><XCircle size={16} /></button>}
        </div>
      )}
    </article>
  )
}
