import React, { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { CheckCircle2, ChefHat, Clock, Hand, Hourglass, PackageCheck, Search, ThumbsUp, Timer, XCircle } from 'lucide-react'
import { api, rupee, useApi } from '../api.js'
import { ErrorState, FoodImg, Spinner, StatusBadge, useToast } from '../components/ui.jsx'

const STEPS = [
  { s: 'Pending', icon: Timer, note: 'Order received' },
  { s: 'Accepted', icon: ThumbsUp, note: 'Kitchen accepted' },
  { s: 'Preparing', icon: ChefHat, note: 'Being prepared' },
  { s: 'Ready for Pickup', icon: PackageCheck, note: 'Ready at counter' },
  { s: 'Completed', icon: CheckCircle2, note: 'Collected' },
]
const PAY = { cash_on_pickup: 'Cash on pickup', simulated_upi: 'UPI (simulated)', simulated_card: 'Card (simulated)' }

const STATUS_MSG = {
  Pending: { text: 'Your order has been placed and is waiting for the kitchen to accept it.', color: 'bg-amber-50 text-amber-800 border-amber-200', emoji: '⏳' },
  Accepted: { text: 'The kitchen has accepted your order and will start preparing it soon.', color: 'bg-sky-50 text-sky-800 border-sky-200', emoji: '👍' },
  Preparing: { text: 'Your food is being prepared right now! Almost there…', color: 'bg-orange-50 text-orange-800 border-orange-200', emoji: '👨‍🍳' },
  'Ready for Pickup': { text: 'Your order is ready! Head to the counter to pick it up.', color: 'bg-emerald-50 text-emerald-800 border-emerald-200', emoji: '✅' },
  Completed: { text: 'You have collected your order. Enjoy your meal!', color: 'bg-stone-100 text-stone-700 border-stone-200', emoji: '🎉' },
  Cancelled: { text: 'This order was cancelled.', color: 'bg-red-50 text-red-700 border-red-200', emoji: '❌' },
}

const STATUS_PILL = {
  Pending: 'bg-amber-100 text-amber-800',
  Accepted: 'bg-sky-100 text-sky-800',
  Preparing: 'bg-orange-100 text-orange-800',
  'Ready for Pickup': 'bg-emerald-100 text-emerald-800',
  Completed: 'bg-stone-200 text-stone-700',
  Cancelled: 'bg-red-100 text-red-700',
  'Not Found': 'bg-ink-100 text-ink-500',
}

export default function Track() {
  const { orderId } = useParams()
  const [params] = useSearchParams()
  const nav = useNavigate()
  const toast = useToast()
  const [input, setInput] = useState('')
  const mine = JSON.parse(localStorage.getItem('biteq_orders') || '[]')
  const [pastOrders, setPastOrders] = useState(null)

  // Fetch past order statuses
  useEffect(() => {
    if (orderId || mine.length === 0) return
    let alive = true
    async function load() {
      try {
        const data = await api('/api/orders/batch-status', { method: 'POST', body: { order_ids: mine } })
        if (alive) setPastOrders(data)
      } catch { /* ignore */ }
    }
    load()
    const t = setInterval(load, 10000) // refresh every 10s
    return () => { alive = false; clearInterval(t) }
  }, [orderId, mine.length])

  if (!orderId) {
    return (
      <div className="max-w-xl mx-auto">
        <h1 className="text-2xl font-extrabold mb-4">Track your order</h1>
        <form className="card p-5 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (input.trim()) nav(`/track/${input.trim().toUpperCase()}`) }}>
          <input className="input" placeholder="Enter order ID, e.g. TK-01" value={input} onChange={(e) => setInput(e.target.value)} />
          <button className="btn-primary"><Search size={16} /> Track</button>
        </form>
        {mine.length > 0 && (
          <div className="card p-5 mt-4">
            <p className="font-bold mb-3">Your recent orders</p>
            {pastOrders ? (
              <div className="space-y-2">
                {pastOrders.map((o) => (
                  <Link key={o.order_id} to={`/track/${o.order_id}`}
                    className="flex items-center gap-3 rounded-xl border border-ink-100 bg-white px-4 py-3 hover:border-brand-400 hover:shadow-sm transition">
                    <div className="flex-1 min-w-0">
                      <p className="font-extrabold text-sm">{o.order_id}</p>
                      {o.status !== 'Not Found' && (
                        <p className="text-xs text-ink-500 mt-0.5">
                          {o.total_quantity} item{o.total_quantity === 1 ? '' : 's'} · {rupee(o.total_amount)} · {o.order_date}
                        </p>
                      )}
                    </div>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${STATUS_PILL[o.status] || 'bg-ink-100'}`}>
                      {o.status === 'Ready for Pickup' ? 'Ready' : o.status}
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <ul className="space-y-1">{mine.map((id) => <li key={id}><Link className="text-brand-600 font-semibold hover:underline" to={`/track/${id}`}>{id}</Link></li>)}</ul>
            )}
          </div>
        )}
      </div>
    )
  }
  return <OrderView orderId={orderId} isNew={params.get('new') === '1'} toast={toast} />
}

function OrderView({ orderId, isNew, toast }) {
  const { data: o, error, loading, reload } = useApi(`/api/orders/${orderId}`, { poll: 4000 })
  const [busy, setBusy] = useState(false)

  if (loading && !o) return <Spinner label="Finding your order…" />
  if (error && !o) return <div className="max-w-xl mx-auto"><ErrorState error={error} retry={reload} /><Link to="/track" className="btn-ghost mt-3 w-full">Try another order ID</Link></div>

  const cancelled = o.status === 'Cancelled'
  const completed = o.status === 'Completed'
  const idx = STEPS.findIndex((s) => s.s === o.status)
  const statusInfo = STATUS_MSG[o.status]
  const prepMin = o.estimated_prep_minutes || 0

  async function cancel() {
    if (!confirm('Cancel this order? Your pickup slot will be released.')) return
    setBusy(true)
    try { await api(`/api/orders/${o.order_id}/status`, { method: 'PATCH', body: { status: 'Cancelled' } }); toast('Order cancelled. Slot released.'); reload() }
    catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }

  async function pickUp() {
    if (!confirm('Confirm that you have picked up your order?')) return
    setBusy(true)
    try { await api(`/api/orders/${o.order_id}/status`, { method: 'PATCH', body: { status: 'Completed' } }); toast('🎉 Order picked up! Enjoy your meal!'); reload() }
    catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {isNew && !cancelled && (
        <div className="rounded-3xl bg-emerald-600 text-white p-6 text-center animate-pop">
          <CheckCircle2 size={44} className="mx-auto mb-2" />
          <h1 className="text-2xl font-extrabold">Order confirmed!</h1>
          <p className="text-white/90 text-sm mt-1">Show this order ID at the counter at your pickup time.</p>
        </div>
      )}

      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-ink-500">Order ID</p>
            <p className="text-2xl font-extrabold tracking-wide select-all">{o.order_id}</p>
            <p className="text-sm text-ink-500">for {o.customer_name}</p>
          </div>
          <StatusBadge status={o.status} />
        </div>
        <div className="mt-4 grid sm:grid-cols-3 gap-3">
          <div className="rounded-2xl bg-brand-50 p-4">
            <p className="text-xs font-bold text-brand-700 flex items-center gap-1"><Clock size={13} /> ESTIMATED PICKUP</p>
            <p className="text-xl font-extrabold mt-1">{o.estimated_pickup_time}</p>
            <p className="text-xs text-ink-500">{o.order_date}</p>
          </div>
          <div className="rounded-2xl bg-orange-50 p-4">
            <p className="text-xs font-bold text-orange-700 flex items-center gap-1"><Hourglass size={13} /> PREP TIME</p>
            <p className="text-xl font-extrabold mt-1">{prepMin} min</p>
            <p className="text-xs text-ink-500">{o.total_quantity} item{o.total_quantity === 1 ? '' : 's'}</p>
          </div>
          <div className="rounded-2xl bg-ink-100 p-4">
            <p className="text-xs font-bold text-ink-500">QUEUE</p>
            <p className="text-xl font-extrabold mt-1">{['Pending', 'Accepted', 'Preparing'].includes(o.status) ? `${o.orders_ahead} order${o.orders_ahead === 1 ? '' : 's'} ahead` : '—'}</p>
            <p className="text-xs text-ink-500">{PAY[o.payment_method]}</p>
          </div>
        </div>
      </div>

      {/* Live status message */}
      {statusInfo && (
        <div className={`rounded-2xl border p-4 flex items-start gap-3 ${statusInfo.color}`}>
          <span className="text-2xl">{statusInfo.emoji}</span>
          <div>
            <p className="font-bold text-sm">{o.status === 'Ready for Pickup' ? 'Ready for Pickup!' : o.status}</p>
            <p className="text-sm mt-0.5">{statusInfo.text}</p>
          </div>
        </div>
      )}

      <div className="card p-5">
        <h2 className="font-extrabold mb-4">Order progress</h2>
        {cancelled ? (
          <div className="flex items-center gap-2 text-red-700 font-bold"><XCircle /> This order was cancelled.</div>
        ) : (
          <ol className="grid grid-cols-5 gap-1">
            {STEPS.map(({ s, icon: Icon, note }, i) => {
              const done = i <= idx
              return (
                <li key={s} className="flex flex-col items-center text-center">
                  <span className={`grid place-items-center h-10 w-10 rounded-full transition ${done ? 'bg-brand-500 text-white' : 'bg-ink-100 text-ink-500'} ${i === idx ? 'ring-4 ring-brand-200' : ''}`}><Icon size={18} /></span>
                  <span className={`mt-1.5 text-[11px] leading-tight font-bold ${done ? 'text-ink-900' : 'text-ink-500'}`}>{s === 'Ready for Pickup' ? 'Ready' : s}</span>
                  <span className="hidden sm:block text-[10px] text-ink-500">{note}</span>
                </li>
              )
            })}
          </ol>
        )}
        <p className="text-xs text-ink-500 mt-4">Updates automatically every few seconds.</p>
      </div>

      <div className="card p-5">
        <h2 className="font-extrabold mb-3">Items</h2>
        <ul className="divide-y divide-ink-100">
          {o.items.map((i) => (
            <li key={i.menu_item_id} className="flex items-center gap-3 py-2">
              <FoodImg src={i.image} alt="" className="h-10 w-10 rounded-lg" />
              <span className="flex-1 font-semibold text-sm">{i.name} <span className="text-ink-500">× {i.quantity}</span></span>
              <span className="font-bold text-sm">{rupee(i.line_total)}</span>
            </li>
          ))}
        </ul>
        <div className="flex justify-between pt-3 mt-1 border-t border-ink-100 font-extrabold"><span>Total</span><span>{rupee(o.total_amount)}</span></div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        <Link to="/order" className="btn-primary flex-1">Order more food</Link>
        {o.status === 'Ready for Pickup' && (
          <button className="btn bg-emerald-500 text-white hover:bg-emerald-600 shadow-sm flex items-center gap-2" disabled={busy} onClick={pickUp}>
            <Hand size={16} /> I've picked it up
          </button>
        )}
        {o.status === 'Pending' && <button className="btn-danger" disabled={busy} onClick={cancel}>Cancel order</button>}
      </div>
    </div>
  )
}
