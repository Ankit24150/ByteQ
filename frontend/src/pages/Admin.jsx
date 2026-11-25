import React, { useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Activity, CalendarDays, Flame, IndianRupee, LineChart as LineIcon, Lightbulb, RotateCcw, ShoppingBag, TrendingDown, TrendingUp, Trophy } from 'lucide-react'
import { api, rupee, useApi } from '../api.js'
import { Empty, ErrorState, SourceBadge, Spinner, StatusBadge, useToast } from '../components/ui.jsx'

const BRAND = '#ea580c', SOFT = '#fdba74', INK = '#44403c', GRID = '#e7e5e4'
const WD = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const short = (d) => d.slice(0, 3)

export default function Admin() {
  const [tab, setTab] = useState('historical')
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold flex items-center gap-2"><LineIcon className="text-brand-500" /> Admin & analytics</h1>
          <p className="text-sm text-ink-500">Insights to cut queues and food wastage.</p>
        </div>
        <div className="inline-flex rounded-xl bg-ink-100 p-1">
          {[['historical', 'Historical dataset'], ['live', 'Live orders']].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`rounded-lg px-4 py-2 text-sm font-bold transition ${tab === k ? 'bg-white shadow text-ink-900' : 'text-ink-500'}`}>{l}</button>
          ))}
        </div>
      </div>
      {tab === 'historical' ? <Historical /> : <Live />}
    </div>
  )
}

function Section({ letter, title, subtitle, children }) {
  return (
    <section className="card p-5">
      <div className="mb-4">
        <h2 className="text-lg font-extrabold flex items-center gap-2">{letter && <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-500 text-white text-sm">{letter}</span>}{title}</h2>
        {subtitle && <p className="text-sm text-ink-500 mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </section>
  )
}
const Stat = ({ icon: Icon, label, value, sub }) => (
  <div className="card p-4">
    <p className="text-xs font-bold uppercase tracking-wide text-ink-500 flex items-center gap-1.5"><Icon size={14} className="text-brand-500" />{label}</p>
    <p className="text-2xl font-extrabold mt-1">{value}</p>
    {sub && <p className="text-xs text-ink-500">{sub}</p>}
  </div>
)

function Historical() {
  const sum = useApi('/api/analytics/summary')
  const peak = useApi('/api/analytics/peak-slots')
  const top = useApi('/api/analytics/top-items')
  const daily = useApi('/api/analytics/daily-sales')
  const demand = useApi('/api/analytics/demand')
  const [wd, setWd] = useState(WD[(new Date().getDay() + 6) % 7])
  const [recWd, setRecWd] = useState('')
  const rec = useApi(`/api/analytics/recommendations${recWd ? `?weekday=${recWd}` : ''}`)

  const err = sum.error || peak.error || top.error || daily.error || demand.error
  if (err) return <ErrorState error={err} retry={() => { sum.reload(); peak.reload(); top.reload(); daily.reload(); demand.reload() }} />
  if (!sum.data || !peak.data || !top.data || !daily.data || !demand.data) return <Spinner label="Crunching 30 days of orders…" />
  const s = sum.data

  return (
    <div className="space-y-6">
      <SourceBadge />
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <Stat icon={ShoppingBag} label="Total orders" value={s.total_orders.toLocaleString('en-IN')} sub={`${s.first_date} → ${s.last_date}`} />
        <Stat icon={Activity} label="Units sold" value={s.total_units.toLocaleString('en-IN')} />
        <Stat icon={IndianRupee} label="Revenue" value={rupee(s.total_revenue)} />
        <Stat icon={CalendarDays} label="Avg orders / day" value={s.avg_daily_orders} />
        <Stat icon={Flame} label="Peak 15-min slot" value={peak.data.peak.label} sub={`${s.peak_slot_orders} orders`} />
        <Stat icon={Trophy} label="Top item" value={s.top_item} sub={`${s.top_item_units} units`} />
      </div>

      <Section letter="A" title="Peak time analysis" subtitle="Orders per 15-minute interval across all 30 days. The peak period is highlighted.">
        <div className="h-72">
          <ResponsiveContainer>
            <BarChart data={peak.data.slots} margin={{ left: -10 }}>
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis dataKey="slot" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v, n) => [v, n === 'total_orders' ? 'Orders' : n]} labelFormatter={(l) => `Slot starting ${l}`} />
              <Bar dataKey="total_orders" radius={[6, 6, 0, 0]}>
                {peak.data.slots.map((d) => <Cell key={d.slot} fill={d.is_peak ? BRAND : SOFT} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {peak.data.busiest.map((b, i) => (
            <span key={b.slot} className={`rounded-xl px-3 py-1.5 text-sm font-bold ${i === 0 ? 'bg-brand-500 text-white' : 'bg-brand-50 text-brand-700'}`}>#{i + 1} {b.label} · {b.total_orders} orders (~{b.avg_orders_per_day}/day)</span>
          ))}
        </div>
      </Section>

      <Section letter="B" title="Popular food analysis" subtitle="Quantities sold, top 5 overall and by weekday.">
        <div className="grid lg:grid-cols-2 gap-6">
          <div>
            <h3 className="font-bold text-sm mb-2">Top 5 overall</h3>
            <HBar data={top.data.overall.map((r) => ({ name: r.item, value: r.quantity_sold }))} />
          </div>
          <div>
            <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
              <h3 className="font-bold text-sm">Top 5 on {wd}s</h3>
              <div className="flex gap-1 flex-wrap">{WD.map((d) => <button key={d} onClick={() => setWd(d)} className={`rounded-lg px-2 py-1 text-xs font-bold ${wd === d ? 'bg-brand-500 text-white' : 'bg-ink-100 text-ink-700'}`}>{short(d)}</button>)}</div>
            </div>
            <HBar data={(top.data.by_weekday[wd] || []).map((r) => ({ name: r.item, value: r.quantity_sold }))} />
          </div>
        </div>
        <div className="overflow-x-auto mt-5">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-ink-500 uppercase"><th className="py-2 pr-3">Weekday</th>{[1, 2, 3, 4, 5].map((n) => <th key={n} className="py-2 pr-3">#{n}</th>)}</tr></thead>
            <tbody>
              {WD.map((d) => (
                <tr key={d} className="border-t border-ink-100">
                  <td className="py-2 pr-3 font-bold">{d}</td>
                  {(top.data.by_weekday[d] || []).map((r) => <td key={r.item} className="py-2 pr-3 whitespace-nowrap">{r.item} <span className="text-ink-500">({r.quantity_sold})</span></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section letter="C" title="Daily sales analysis" subtitle="Orders, units and revenue for each day of the dataset.">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <Stat icon={ShoppingBag} label="Avg daily orders" value={daily.data.average_daily_orders} />
          <Stat icon={Activity} label="Avg daily units" value={daily.data.average_daily_units} />
          <Stat icon={IndianRupee} label="Avg daily revenue" value={rupee(daily.data.average_daily_revenue)} />
          <Stat icon={Trophy} label="Busiest day" value={`${daily.data.busiest_day.total_orders} orders`} sub={`${daily.data.busiest_day.weekday} ${daily.data.busiest_day.date}`} />
        </div>
        <div className="h-72">
          <ResponsiveContainer>
            <ComposedChart data={daily.data.days.map((d) => ({ ...d, label: d.date.slice(5) }))} margin={{ left: -10, right: 10 }}>
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={2} />
              <YAxis yAxisId="l" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11 }} tickFormatter={(v) => `₹${v / 1000}k`} />
              <Tooltip formatter={(v, n) => (n === 'Revenue' ? rupee(v) : v)} />
              <Legend />
              <Bar yAxisId="l" dataKey="total_orders" name="Orders" fill={SOFT} radius={[4, 4, 0, 0]} />
              <Line yAxisId="l" dataKey="total_units" name="Units sold" stroke={INK} strokeWidth={2} dot={false} />
              <Line yAxisId="r" dataKey="revenue" name="Revenue" stroke={BRAND} strokeWidth={2.5} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Section>

      <Section letter="D" title="Food demand analysis" subtitle="High / low demand items and weekday patterns (average units per weekday).">
        <div className="grid sm:grid-cols-2 gap-3 mb-4">
          <div className="rounded-xl bg-emerald-50 p-3"><p className="text-sm font-bold text-emerald-800 flex items-center gap-1.5"><TrendingUp size={16} /> High demand</p><p className="text-sm mt-1">{demand.data.high_demand.join(', ')}</p></div>
          <div className="rounded-xl bg-red-50 p-3"><p className="text-sm font-bold text-red-800 flex items-center gap-1.5"><TrendingDown size={16} /> Low demand (waste risk)</p><p className="text-sm mt-1">{demand.data.low_demand.join(', ')}</p></div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-ink-500 uppercase"><th className="text-left py-2 pr-3">Item</th><th className="py-2">Demand</th>{WD.map((d) => <th key={d} className="py-2 px-1">{short(d)}</th>)}<th className="py-2 pl-2">7-day trend</th></tr></thead>
            <tbody>
              {demand.data.items.map((it) => {
                const max = Math.max(...Object.values(it.weekday_avg), 1)
                return (
                  <tr key={it.item} className="border-t border-ink-100">
                    <td className="py-1.5 pr-3 font-bold whitespace-nowrap">{it.item}</td>
                    <td className="text-center"><span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${it.demand_level === 'High' ? 'bg-emerald-100 text-emerald-800' : it.demand_level === 'Low' ? 'bg-red-100 text-red-700' : 'bg-ink-100 text-ink-700'}`}>{it.demand_level}</span></td>
                    {WD.map((d) => <td key={d} className="text-center px-1"><span className="block rounded-md py-1 text-xs font-bold" style={{ background: `rgba(234,88,12,${0.08 + 0.7 * (it.weekday_avg[d] / max)})`, color: it.weekday_avg[d] / max > 0.6 ? '#fff' : INK }}>{it.weekday_avg[d]}</span></td>)}
                    <td className={`pl-2 text-xs font-bold whitespace-nowrap ${it.trend_pct >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{it.trend_pct >= 0 ? '▲' : '▼'} {Math.abs(it.trend_pct)}%</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <h3 className="font-bold text-sm mt-6 mb-2">Average orders per weekday</h3>
        <div className="h-52">
          <ResponsiveContainer>
            <BarChart data={demand.data.weekday_trend.map((d) => ({ ...d, wd: short(d.weekday) }))} margin={{ left: -10 }}>
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis dataKey="wd" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} />
              <Tooltip /><Bar dataKey="avg_orders" name="Avg orders" fill={BRAND} radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Section>

      <Section letter="★" title="Smart cook-ahead recommendations" subtitle="How much to prepare, with the reasoning, based on the historical dataset.">
        <div className="flex gap-1 flex-wrap mb-3">
          <button onClick={() => setRecWd('')} className={`rounded-lg px-3 py-1.5 text-xs font-bold ${!recWd ? 'bg-brand-500 text-white' : 'bg-ink-100'}`}>Next service day</button>
          {WD.map((d) => <button key={d} onClick={() => setRecWd(d)} className={`rounded-lg px-3 py-1.5 text-xs font-bold ${recWd === d ? 'bg-brand-500 text-white' : 'bg-ink-100'}`}>{short(d)}</button>)}
        </div>
        {!rec.data ? <Spinner /> : rec.error ? <ErrorState error={rec.error} /> : (
          <>
            <p className="rounded-xl bg-brand-50 text-brand-700 font-bold text-sm px-4 py-2 mb-3 flex items-center gap-2"><Lightbulb size={16} /> Plan for {rec.data.weekday}{rec.data.target_date ? ` (${rec.data.target_date})` : ''}: about {rec.data.total_recommended_units} units in total.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-ink-500 uppercase"><th className="py-2 pr-3">Item</th><th className="pr-3">Demand</th><th className="pr-3 text-right">Avg</th><th className="pr-3 text-right">Prepare</th><th className="pr-3">Cook by</th><th>Why</th></tr></thead>
                <tbody>
                  {rec.data.recommendations.map((r) => (
                    <tr key={r.item} className="border-t border-ink-100 align-top">
                      <td className="py-2 pr-3 font-bold whitespace-nowrap">{r.item}</td>
                      <td className="pr-3"><span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${r.demand_level === 'High' ? 'bg-emerald-100 text-emerald-800' : r.demand_level === 'Low' ? 'bg-red-100 text-red-700' : 'bg-ink-100'}`}>{r.demand_level}</span></td>
                      <td className="pr-3 text-right">{r.avg_units_this_weekday}</td>
                      <td className="pr-3 text-right font-extrabold text-brand-600 text-base">{r.recommended_quantity}{r.live_preordered > 0 && <span className="block text-[10px] font-semibold text-emerald-700">{r.live_preordered} pre-ordered</span>}</td>
                      <td className="pr-3 whitespace-nowrap">{r.cook_by || '—'}</td>
                      <td className="text-xs text-ink-700 min-w-[260px]">{r.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Section>
    </div>
  )
}

function HBar({ data }) {
  if (!data.length) return <Empty title="No data" />
  return (
    <div style={{ height: 40 * data.length + 20 }}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ left: 10, right: 30 }}>
          <CartesianGrid horizontal={false} stroke={GRID} />
          <XAxis type="number" tick={{ fontSize: 11 }} /><YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 12 }} />
          <Tooltip formatter={(v) => [`${v} units`, 'Sold']} />
          <Bar dataKey="value" radius={[0, 6, 6, 0]} label={{ position: 'right', fontSize: 11 }}>
            {data.map((d, i) => <Cell key={d.name} fill={i === 0 ? BRAND : SOFT} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function Live() {
  const toast = useToast()
  const live = useApi('/api/analytics/live', { poll: 4000 })
  if (live.error && !live.data) return <ErrorState error={live.error} retry={live.reload} />
  if (!live.data) return <Spinner />
  const d = live.data
  async function reset() {
    if (!confirm('Delete ALL live orders and reset slot bookings? (The historical dataset is not touched.)')) return
    try { const r = await api('/api/admin/reset-live', { method: 'POST' }); toast(r.message); live.reload() } catch (e) { toast(e.message, 'error') }
  }
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2"><SourceBadge live /><button className="btn-danger" onClick={reset}><RotateCcw size={15} /> Reset live demo data</button></div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat icon={ShoppingBag} label="Orders today" value={d.orders_today} sub="excluding cancelled" />
        <Stat icon={IndianRupee} label="Revenue today" value={rupee(d.revenue_today)} />
        <Stat icon={Flame} label="In kitchen" value={(d.by_status.Pending || 0) + (d.by_status.Accepted || 0) + (d.by_status.Preparing || 0)} />
        <Stat icon={Trophy} label="Completed" value={d.by_status.Completed || 0} />
      </div>
      <Section title="Live slot occupancy" subtitle="Booked orders vs capacity for every pickup slot today.">
        <div className="h-72">
          <ResponsiveContainer>
            <BarChart data={d.slots} margin={{ left: -10 }}>
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis dataKey="slot" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip /><Legend />
              <Bar dataKey="booked" name="Booked" fill={BRAND} radius={[6, 6, 0, 0]} />
              <Bar dataKey="capacity" name="Capacity" fill="#e7e5e4" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Section>
      <div className="grid lg:grid-cols-2 gap-6">
        <Section title="Orders by status">
          {Object.keys(d.by_status).length ? <div className="flex flex-wrap gap-3">{Object.entries(d.by_status).map(([s, n]) => <div key={s} className="rounded-xl bg-ink-100 px-4 py-2 text-center"><p className="text-2xl font-extrabold">{n}</p><StatusBadge status={s} /></div>)}</div> : <Empty title="No live orders yet" hint="Place an order from the student page." />}
        </Section>
        <Section title="Top items ordered today">
          {d.top_items.length ? <HBar data={d.top_items.map((t) => ({ name: t.item, value: t.quantity }))} /> : <Empty title="No live orders yet" />}
        </Section>
      </div>
    </div>
  )
}
