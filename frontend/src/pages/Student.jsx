import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Clock, Hourglass, Minus, Plus, Search, ShoppingBag, Sparkles, Wallet, X, Zap, AlertTriangle, ArrowRight, Search as SearchIcon, ReceiptText } from 'lucide-react'
import { api, ApiError, rupee, useApi } from '../api.js'
import { Empty, ErrorState, FoodImg, QueueMeter, SLOT_COLOR, Spinner, useToast } from '../components/ui.jsx'

const CATEGORIES = ['All', 'Snacks', 'Meals', 'Beverages', 'Fast Food']
const PAYMENTS = [
  { id: 'cash_on_pickup', label: 'Cash on pickup' },
  { id: 'simulated_upi', label: 'UPI (simulated)' },
]

export default function Student() {
  const toast = useToast()
  const nav = useNavigate()
  const menu = useApi('/api/menu')
  const slotsApi = useApi('/api/slots', { poll: 5000 })
  const combos = useApi('/api/combos')
  const hotItem = useApi('/api/analytics/hot-today', { poll: 30000 })

  const [category, setCategory] = useState('All')
  const [q, setQ] = useState('')
  const [cart, setCart] = useState({})
  const [slotId, setSlotId] = useState(null)
  const [name, setName] = useState(() => localStorage.getItem('biteq_name') || '')
  const [payment, setPayment] = useState('cash_on_pickup')
  const [placing, setPlacing] = useState(false)
  const [fullInfo, setFullInfo] = useState(null)
  const [drawer, setDrawer] = useState(false)

  const items = menu.data || []
  const byId = useMemo(() => Object.fromEntries(items.map((i) => [i.id, i])), [items])
  const slots = slotsApi.data?.slots || []
  const bestSlot = slotsApi.data?.best_slot

  // Smart pickup: pre-select the quietest slot until the student chooses one
  useEffect(() => {
    if (slotId == null && bestSlot) setSlotId(bestSlot.id)
  }, [bestSlot, slotId])
  // If the chosen slot fills up while browsing, tell the student immediately
  useEffect(() => {
    const s = slots.find((x) => x.id === slotId)
    if (s && !s.bookable) {
      setFullInfo({ message: `The ${s.label} slot just filled up. Please choose another slot.`, suggested_slot: bestSlot })
      setSlotId(null)
    }
  }, [slots, slotId, bestSlot])

  const lines = Object.entries(cart).map(([id, qty]) => ({ item: byId[id], qty })).filter((l) => l.item)
  const total = lines.reduce((s, l) => s + l.item.price * l.qty, 0)
  const count = lines.reduce((s, l) => s + l.qty, 0)
  const prepMinutes = count > 0 ? 3 + count * 2 : 0
  const selected = slots.find((s) => s.id === slotId)

  const setQty = (id, qty) => setCart((c) => {
    const n = { ...c }
    if (qty <= 0) { delete n[id]; return n }
    const currentTotal = Object.entries(n).reduce((s, [k, v]) => s + (k === id ? 0 : v), 0)
    const maxAllowed = 4 - currentTotal
    if (maxAllowed <= 0) { toast('Order limit: max 4 items per order.', 'error'); return c }
    n[id] = Math.min(qty, maxAllowed)
    return n
  })
  const addCombo = (combo) => {
    setCart((c) => {
      const n = { ...c }
      const currentTotal = Object.values(n).reduce((s, v) => s + v, 0)
      let remaining = 4 - currentTotal
      combo.items.forEach((i) => {
        if (remaining <= 0) return
        const add = Math.min(1, remaining)
        n[i.id] = Math.min((n[i.id] || 0) + add, 4)
        remaining -= add
      })
      if (remaining <= 0 && combo.items.length > (4 - currentTotal)) {
        toast('Some combo items skipped — max 4 items per order.', 'error')
      }
      return n
    })
    toast(`${combo.name} added to cart`)
  }

  const shown = items.filter((i) =>
    (category === 'All' || i.category === category) && i.name.toLowerCase().includes(q.trim().toLowerCase()))

  async function place() {
    if (name.trim().length < 2) return toast('Please enter your name (at least 2 letters).', 'error')
    if (!count) return toast('Your cart is empty.', 'error')
    if (!slotId) return toast('Please choose a pickup slot.', 'error')
    setPlacing(true); setFullInfo(null)
    try {
      localStorage.setItem('biteq_name', name.trim())
      const o = await api('/api/orders', { method: 'POST', body: {
        customer_name: name.trim(), slot_id: slotId, payment_method: payment,
        items: lines.map((l) => ({ menu_item_id: l.item.id, quantity: l.qty })),
      } })
      const mine = JSON.parse(localStorage.getItem('biteq_orders') || '[]')
      localStorage.setItem('biteq_orders', JSON.stringify([o.order_id, ...mine].slice(0, 20)))
      toast(`Order ${o.order_id} confirmed!`)
      nav(`/track/${o.order_id}?new=1`)
    } catch (e) {
      if (e instanceof ApiError && e.detail.code === 'SLOT_FULL') {
        setFullInfo(e.detail); setSlotId(null); slotsApi.reload()
      } else if (e instanceof ApiError && e.detail.code === 'ITEM_UNAVAILABLE') {
        menu.reload()
      }
      toast(e.message, 'error')
    } finally { setPlacing(false) }
  }

  const cartPanel = (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-extrabold flex items-center gap-2"><ShoppingBag size={18} className="text-brand-500" /> Your order</h2>
        <button className="lg:hidden p-1 text-ink-500" onClick={() => setDrawer(false)} aria-label="Close cart"><X /></button>
      </div>

      {lines.length === 0 ? <Empty icon={ShoppingBag} title="Your cart is empty" hint="Add something tasty from the menu." /> : (
        <ul className="divide-y divide-ink-100">
          {lines.map(({ item, qty }) => (
            <li key={item.id} className="flex items-center gap-3 py-2.5">
              <FoodImg src={item.image} alt="" className="h-11 w-11 rounded-lg" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold truncate">{item.name}</p>
                <p className="text-xs text-ink-500">{rupee(item.price)} each</p>
              </div>
              <Stepper qty={qty} onChange={(n) => setQty(item.id, n)} />
              <span className="w-12 text-right text-sm font-bold">{rupee(item.price * qty)}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4">
        <p className="text-sm font-bold mb-2 flex items-center gap-1.5"><Clock size={15} className="text-brand-500" /> Pickup slot</p>
        {slotsApi.loading && !slots.length ? <Spinner label="Loading slots…" /> : slotsApi.error && !slots.length ? <ErrorState error={slotsApi.error} retry={slotsApi.reload} /> : (
          <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto pr-1">
            {slots.map((s) => {
              const c = SLOT_COLOR[s.status]
              const active = s.id === slotId
              return (
                <button key={s.id} disabled={!s.bookable} onClick={() => { setSlotId(s.id); setFullInfo(null) }}
                  className={`relative text-left rounded-xl border px-3 py-2 transition ${active ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-200' : 'border-ink-300 bg-white hover:border-brand-400'} ${!s.bookable ? 'opacity-50 cursor-not-allowed bg-ink-100' : ''}`}>
                  <span className="block text-xs font-bold">{s.label}</span>
                  <span className={`block text-[11px] font-semibold ${c.text}`}>{s.bookable ? `${s.remaining} left · ${s.status}` : s.status}</span>
                  {s.recommended && s.bookable && <span className="absolute -top-2 right-2 rounded-full bg-brand-500 px-1.5 py-0.5 text-[9px] font-bold text-white flex items-center gap-0.5"><Sparkles size={9} /> Quieter</span>}
                </button>
              )
            })}
          </div>
        )}
        {fullInfo && (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 animate-pop" role="alert">
            <p className="font-bold flex items-center gap-1.5"><AlertTriangle size={15} /> Slot is full</p>
            <p className="mt-1">{fullInfo.message}</p>
            {fullInfo.suggested_slot && (
              <button className="btn-primary mt-2 w-full" onClick={() => { setSlotId(fullInfo.suggested_slot.id); setFullInfo(null) }}>
                Switch to {fullInfo.suggested_slot.label} <ArrowRight size={15} />
              </button>
            )}
          </div>
        )}
        {selected?.recommendation_reason && !fullInfo && <p className="mt-2 text-xs text-ink-500 flex gap-1"><Sparkles size={13} className="text-brand-500 shrink-0 mt-0.5" />{selected.recommendation_reason}</p>}
      </div>

      <div className="mt-4 space-y-3">
        <input className="input" placeholder="Your name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} aria-label="Your name" />
        <div className="flex gap-2">
          {PAYMENTS.map((p) => (
            <button key={p.id} onClick={() => setPayment(p.id)} className={`flex-1 chip flex items-center justify-center gap-1.5 ${payment === p.id ? 'bg-ink-900 text-white border-ink-900' : 'bg-white text-ink-700 border-ink-300'}`}>
              <Wallet size={14} />{p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 pt-4 border-t border-ink-100">
        {count > 0 && (
          <div className="flex items-center gap-2 mb-3 rounded-xl bg-brand-50 px-3 py-2">
            <Hourglass size={15} className="text-brand-500 shrink-0" />
            <span className="text-sm font-semibold text-brand-700">
              Est. prep time: <span className="font-extrabold">{prepMinutes} min</span>
            </span>
          </div>
        )}
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold text-ink-500">Total ({count} item{count === 1 ? '' : 's'})</span>
          <span className="text-2xl font-extrabold">{rupee(total)}</span>
        </div>
        <button className="btn-primary w-full py-3 text-base" disabled={placing || !count} onClick={place}>
          {placing ? 'Confirming…' : <>Confirm order {selected && <span className="opacity-80 font-medium">· pickup {selected.label}</span>}</>}
        </button>
      </div>
    </div>
  )

  return (
    <div>
      {/* Hero */}
      <section className="rounded-3xl bg-gradient-to-br from-brand-500 via-brand-600 to-orange-700 text-white p-6 sm:p-10 mb-6 relative overflow-hidden">
        <div className="absolute -right-10 -top-10 h-56 w-56 rounded-full bg-white/10" />
        <div className="absolute right-24 -bottom-16 h-40 w-40 rounded-full bg-white/10" />
        <p className="text-xs font-bold tracking-widest uppercase text-white/80">College Canteen · Lunch 11 AM – 3 PM</p>
        <h1 className="mt-2 text-3xl sm:text-5xl font-extrabold tracking-tight max-w-2xl">Order now. Pick up on time. Skip the queue.</h1>
        <div className="mt-5 flex flex-wrap gap-2 text-sm font-semibold">
          {['1  Pick your food', '2  Choose a pickup slot', '3  Confirm & collect'].map((s) => <span key={s} className="rounded-full bg-white/20 px-4 py-1.5 backdrop-blur">{s}</span>)}
        </div>
        <Link to="/track" className="mt-5 inline-flex items-center gap-2 text-sm font-bold underline underline-offset-4"><SearchIcon size={15} /> Track an existing order</Link>
      </section>

      {/* Hot Order of the Day */}
      {hotItem.data?.item && (
        <section className="mb-6 rounded-2xl bg-gradient-to-r from-red-500 via-orange-500 to-amber-400 text-white p-5 flex items-center gap-4 animate-pop">
          <span className="text-4xl">🔥</span>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold uppercase tracking-widest text-white/80">Hot order of the day</p>
            <p className="text-lg sm:text-xl font-extrabold truncate">{hotItem.data.item}</p>
            <p className="text-sm text-white/90">{hotItem.data.label}</p>
          </div>
          {hotItem.data.price && (
            <div className="text-right shrink-0">
              <p className="text-2xl font-extrabold">{rupee(hotItem.data.price)}</p>
              <p className="text-xs text-white/80">{hotItem.data.quantity} ordered</p>
            </div>
          )}
        </section>
      )}

      <div className="grid lg:grid-cols-[1fr_390px] gap-6 items-start">
        <div className="min-w-0 space-y-8">
          {/* Combos */}
          {combos.data?.combos?.length > 0 && (
            <section>
              <h2 className="text-xl font-extrabold flex items-center gap-2 mb-1"><Zap className="text-brand-500" size={20} /> Combo of the day</h2>
              <p className="text-sm text-ink-500 mb-3">Built from what students order most on {combos.data.weekday}s. Priced exactly as on the menu.</p>
              <div className="grid sm:grid-cols-3 gap-3">
                {combos.data.combos.map((c) => (
                  <div key={c.name} className="card p-4 flex flex-col hover:-translate-y-0.5 transition">
                    <p className="font-extrabold">{c.name}</p>
                    <div className="flex -space-x-3 my-3">{c.items.map((i) => <FoodImg key={i.id} src={i.image} alt={i.name} className="h-12 w-12 rounded-full border-2 border-white" />)}</div>
                    <p className="text-sm text-ink-700 font-medium">{c.items.map((i) => i.name).join(' + ')}</p>
                    <p className="text-xs text-ink-500 mt-1 flex-1">{c.reason}</p>
                    <div className="flex items-center justify-between mt-3">
                      <span className="text-lg font-extrabold">{rupee(c.total_price)}</span>
                      <button className="btn-primary !py-1.5" onClick={() => addCombo(c)}><Plus size={15} /> Add</button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Menu */}
          <section>
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
              <h2 className="text-xl font-extrabold flex-1">Menu</h2>
              <div className="relative sm:w-64">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-500" />
                <input className="input pl-9" placeholder="Search food…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search food" />
              </div>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-2 mb-3">
              {CATEGORIES.map((c) => (
                <button key={c} onClick={() => setCategory(c)} className={`chip ${category === c ? 'bg-brand-500 text-white border-brand-500' : 'bg-white text-ink-700 border-ink-300 hover:border-brand-400'}`}>{c}</button>
              ))}
            </div>
            {menu.loading ? (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton h-56" />)}</div>
            ) : menu.error ? <ErrorState error={menu.error} retry={menu.reload} /> : shown.length === 0 ? (
              <Empty icon={Search} title="No food found" hint="Try a different search or category." />
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
                {shown.map((i) => (
                  <article key={i.id} className={`card overflow-hidden group hover:-translate-y-1 hover:shadow-lg transition ${!i.available ? 'opacity-60' : ''}`}>
                    <div className="relative overflow-hidden">
                      <FoodImg src={i.image} alt={i.name} className="w-full h-28 sm:h-36 group-hover:scale-105 transition duration-300" />
                      <span className="absolute top-2 left-2 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-bold text-ink-700">{i.category}</span>
                      {!i.available && <span className="absolute inset-0 grid place-items-center bg-black/50 text-white text-sm font-extrabold">Sold out</span>}
                    </div>
                    <div className="p-3">
                      <h3 className="font-bold text-sm sm:text-base leading-tight">{i.name}</h3>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="font-extrabold">{rupee(i.price)}</span>
                        {!i.available ? <span className="text-xs font-semibold text-red-600">Unavailable</span>
                          : cart[i.id] ? <Stepper qty={cart[i.id]} onChange={(n) => setQty(i.id, n)} />
                          : <button className="btn-primary !px-3 !py-1.5" onClick={() => setQty(i.id, 1)} aria-label={`Add ${i.name}`}><Plus size={15} /> Add</button>}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          {/* Live queue meter */}
          <section>
            <h2 className="text-xl font-extrabold mb-1">Live queue meter</h2>
            <p className="text-sm text-ink-500 mb-3">Real-time pickup slot occupancy. Updates every few seconds.</p>
            {slots.length ? <QueueMeter slots={slots} /> : <Spinner />}
          </section>
        </div>

        {/* Desktop cart */}
        <aside className="hidden lg:block card p-5 sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto">{cartPanel}</aside>
      </div>

      {/* Mobile cart bar + drawer */}
      {count > 0 && !drawer && (
        <button onClick={() => setDrawer(true)} className="lg:hidden fixed bottom-4 inset-x-4 z-40 btn-primary py-3.5 shadow-xl text-base justify-between animate-pop">
          <span className="flex items-center gap-2"><ShoppingBag size={18} /> {count} item{count > 1 ? 's' : ''}</span>
          <span>View cart · {rupee(total)}</span>
        </button>
      )}
      {drawer && (
        <div className="lg:hidden fixed inset-0 z-50 bg-black/40" onClick={() => setDrawer(false)}>
          <div className="absolute bottom-0 inset-x-0 max-h-[92vh] overflow-y-auto rounded-t-3xl bg-white p-5 animate-pop" onClick={(e) => e.stopPropagation()}>{cartPanel}</div>
        </div>
      )}
      <p className="mt-10 text-center text-xs text-ink-500 flex items-center justify-center gap-1"><ReceiptText size={13} /> Prototype: payments are simulated, pay at the counter on pickup.</p>
    </div>
  )
}

function Stepper({ qty, onChange }) {
  return (
    <div className="inline-flex items-center rounded-xl border border-ink-300 bg-white">
      <button className="p-1.5 hover:bg-ink-100 rounded-l-xl" onClick={() => onChange(qty - 1)} aria-label="Decrease quantity"><Minus size={14} /></button>
      <span className="w-6 text-center text-sm font-bold">{qty}</span>
      <button className="p-1.5 hover:bg-ink-100 rounded-r-xl disabled:opacity-40" disabled={qty >= 10} onClick={() => onChange(qty + 1)} aria-label="Increase quantity"><Plus size={14} /></button>
    </div>
  )
}
