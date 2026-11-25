import React, { useEffect } from 'react'
import { NavLink, Route, Routes, useNavigate, useLocation } from 'react-router-dom'
import { ChefHat, LineChart, LogOut, Store, UtensilsCrossed } from 'lucide-react'
import Student from './pages/Student.jsx'
import Track from './pages/Track.jsx'
import Kitchen from './pages/Kitchen.jsx'
import Admin from './pages/Admin.jsx'
import Login from './pages/Login.jsx'

export default function App() {
  const role = localStorage.getItem('biteq_role')
  const name = localStorage.getItem('biteq_name') || ''
  const location = useLocation()
  const nav = useNavigate()

  // If not logged in, show login page
  if (!role) {
    return (
      <Routes>
        <Route path="*" element={<Login />} />
      </Routes>
    )
  }

  const tabs =
    role === 'student'
      ? [{ to: '/order', label: 'Order Food', icon: Store, end: true }]
      : role === 'kitchen'
        ? [{ to: '/kitchen', label: 'Kitchen', icon: ChefHat }]
        : [{ to: '/admin', label: 'Analytics', icon: LineChart }]

  function logout() {
    localStorage.removeItem('biteq_role')
    nav('/')
    window.location.reload()
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur border-b border-ink-100">
        <div className="mx-auto max-w-7xl px-4 h-16 flex items-center justify-between gap-3">
          <NavLink to={tabs[0].to} className="flex items-center gap-2.5">
            <span className="grid place-items-center h-9 w-9 rounded-xl bg-brand-500 text-white"><UtensilsCrossed size={20} /></span>
            <span className="leading-tight">
              <span className="block text-lg font-extrabold tracking-tight">Bite<span className="text-brand-500">Q</span></span>
              <span className="hidden sm:block text-[11px] font-semibold text-ink-500 -mt-0.5">Smart Canteen · skip the queue</span>
            </span>
          </NavLink>
          <div className="flex items-center gap-2">
            <nav className="flex gap-1">
              {tabs.map(({ to, label, icon: Icon, end }) => (
                <NavLink key={to} to={to} end={end}
                  className={({ isActive }) => `flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold transition ${isActive ? 'bg-brand-500 text-white' : 'text-ink-700 hover:bg-ink-100'}`}>
                  <Icon size={16} /> <span className="hidden sm:inline">{label}</span>
                </NavLink>
              ))}
            </nav>
            {name && <span className="hidden sm:inline text-xs font-semibold text-ink-500 border-l border-ink-200 pl-2 ml-1">Hi, {name}</span>}
            <button onClick={logout} className="flex items-center gap-1 rounded-xl px-2.5 py-2 text-sm font-semibold text-ink-500 hover:bg-red-50 hover:text-red-600 transition" title="Logout">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">
        <Routes>
          <Route path="/order" element={<Student />} />
          <Route path="/track" element={<Track />} />
          <Route path="/track/:orderId" element={<Track />} />
          <Route path="/kitchen" element={<Kitchen />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="*" element={<Redirect role={role} />} />
        </Routes>
      </main>
    </div>
  )
}

function Redirect({ role }) {
  const nav = useNavigate()
  useEffect(() => {
    const path = role === 'student' ? '/order' : role === 'kitchen' ? '/kitchen' : '/admin'
    nav(path, { replace: true })
  }, [role, nav])
  return null
}
