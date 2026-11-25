import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChefHat, Eye, EyeOff, LineChart, Lock, Store, UtensilsCrossed } from 'lucide-react'

const ROLES = [
  { id: 'student', label: 'Student', icon: Store, desc: 'Order food & track your order', color: 'bg-brand-500', path: '/order', protected: false },
  { id: 'kitchen', label: 'Kitchen Staff', icon: ChefHat, desc: 'Manage orders & cooking queue', color: 'bg-orange-600', path: '/kitchen', protected: true },
  { id: 'admin', label: 'Admin', icon: LineChart, desc: 'View analytics & insights', color: 'bg-indigo-600', path: '/admin', protected: true },
]

// Credentials for protected panels
const CREDENTIALS = {
  kitchen: { userId: 'kitchen', password: 'kitchen@123' },
  admin:   { userId: 'admin',   password: 'admin@123' },
}

export default function Login() {
  const nav = useNavigate()
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [selectedRole, setSelectedRole] = useState(null)
  const [userId, setUserId] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  function login(role) {
    if (role.id === 'student' && name.trim().length < 2) {
      setError('Please enter your name (at least 2 letters).')
      return
    }
    if (role.id === 'student') {
      localStorage.setItem('biteq_name', name.trim())
      localStorage.setItem('biteq_role', role.id)
      nav(role.path)
      return
    }
    // For protected roles, show the credential form
    setSelectedRole(role)
    setUserId('')
    setPassword('')
    setError('')
  }

  function submitCredentials(e) {
    e.preventDefault()
    if (!selectedRole) return
    const cred = CREDENTIALS[selectedRole.id]
    if (userId.trim() !== cred.userId || password !== cred.password) {
      setError('Invalid User ID or Password.')
      return
    }
    localStorage.setItem('biteq_role', selectedRole.id)
    localStorage.setItem('biteq_name', selectedRole.label)
    nav(selectedRole.path)
  }

  // Credential form for Kitchen / Admin
  if (selectedRole) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#fffaf5] px-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-6">
            <div className={`inline-flex items-center justify-center h-16 w-16 rounded-2xl ${selectedRole.color} text-white mb-4`}>
              <selectedRole.icon size={32} />
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight">{selectedRole.label} Login</h1>
            <p className="text-sm text-ink-500 mt-1">Enter your credentials to continue</p>
          </div>

          <form onSubmit={submitCredentials} className="card p-6 space-y-4">
            <div>
              <label className="block text-sm font-bold text-ink-700 mb-1.5">User ID</label>
              <input
                className="input"
                placeholder="Enter user ID"
                value={userId}
                onChange={(e) => { setUserId(e.target.value); setError('') }}
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-ink-700 mb-1.5">Password</label>
              <div className="relative">
                <input
                  className="input pr-10"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Enter password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError('') }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-700"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            {error && (
              <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-sm font-semibold text-red-700 flex items-center gap-2">
                <Lock size={14} /> {error}
              </div>
            )}
            <button type="submit" className={`btn w-full py-3 text-white shadow-sm ${selectedRole.color} hover:opacity-90`}>
              Sign in
            </button>
            <button type="button" onClick={() => { setSelectedRole(null); setError('') }} className="btn-ghost w-full">
              ← Back to roles
            </button>
          </form>
        </div>
      </div>
    )
  }

  // Role selection screen
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#fffaf5] px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-brand-500 text-white mb-4">
            <UtensilsCrossed size={32} />
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight">
            Bite<span className="text-brand-500">Q</span>
          </h1>
          <p className="text-sm text-ink-500 mt-1">Smart Canteen · skip the queue</p>
        </div>

        <div className="card p-6 space-y-5">
          <div>
            <label className="block text-sm font-bold text-ink-700 mb-1.5">Your name</label>
            <input
              className="input"
              placeholder="Enter your name…"
              value={name}
              maxLength={60}
              onChange={(e) => { setName(e.target.value); setError('') }}
            />
            {error && <p className="text-xs text-red-600 font-semibold mt-1">{error}</p>}
          </div>

          <div>
            <p className="text-sm font-bold text-ink-700 mb-2">Continue as</p>
            <div className="grid gap-3">
              {ROLES.map((role) => (
                <button
                  key={role.id}
                  onClick={() => login(role)}
                  className="flex items-center gap-4 rounded-2xl border border-ink-200 bg-white p-4 text-left hover:border-brand-400 hover:shadow-md transition group"
                >
                  <span className={`grid place-items-center h-12 w-12 rounded-xl ${role.color} text-white shrink-0 group-hover:scale-110 transition`}>
                    <role.icon size={22} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-extrabold text-ink-900">{role.label}</p>
                    <p className="text-xs text-ink-500">{role.desc}</p>
                  </div>
                  {role.protected
                    ? <Lock size={16} className="text-ink-400 shrink-0" />
                    : <span className="text-ink-300 group-hover:text-brand-500 transition">→</span>}
                </button>
              ))}
            </div>
          </div>
        </div>

        <p className="text-center text-xs text-ink-500 mt-6">Kitchen & Admin panels require login credentials</p>
      </div>
    </div>
  )
}
