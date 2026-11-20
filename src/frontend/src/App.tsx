import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import Import from './pages/Import'
import Tournaments from './pages/Tournaments'
import HandList from './pages/HandList'
import HandDetail from './pages/HandDetail'
import Replayer from './pages/Replayer'
import Summary from './pages/Summary'
import Bankroll from './pages/Bankroll'
import Advanced from './pages/Advanced'
import ReviewQueue from './pages/ReviewQueue'
import { api } from './api'
import './App.css'

type IconName = 'summary' | 'tournaments' | 'bankroll' | 'review' | 'analysis' | 'import'

const iconShapes: Record<IconName, ReactNode> = {
  summary: <><path d="M4 19V5" /><path d="M4 19h16" /><path d="m7 15 3-4 3 2 5-7" /></>,
  tournaments: <><path d="M4 6h16M4 12h16M4 18h16" /><circle cx="7" cy="6" r=".7" /><circle cx="7" cy="12" r=".7" /><circle cx="7" cy="18" r=".7" /></>,
  bankroll: <><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18" /><path d="M16 15h2" /></>,
  review: <><path d="M6 4h12v17l-6-4-6 4z" /><path d="M9 8h6M9 11h6" /></>,
  analysis: <><path d="M4 19V5M4 19h16" /><path d="M8 16v-4M12 16V8M16 16v-7M20 16v-3" /></>,
  import: <><path d="M12 15V4" /><path d="m8 8 4-4 4 4" /><path d="M5 14v5h14v-5" /></>,
}

function AppIcon({ name }: { readonly name: IconName }) {
  return (
    <svg className="nav-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {iconShapes[name]}
    </svg>
  )
}

function NavigationLink({ to, label, icon }: {
  readonly to: string
  readonly label: string
  readonly icon: IconName
}) {
  return (
    <NavLink to={to} className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
      <AppIcon name={icon} />
      <span>{label}</span>
    </NavLink>
  )
}

export default function App() {
  useEffect(() => {
    api.moveWindowToPrimary().catch(() => undefined)
  }, [])

  return (
    <BrowserRouter>
      <div className="layout">
        <nav className="sidebar">
          <div className="sidebar-title">Expresso <span>Review</span></div>
          <div className="sidebar-group">
            <span className="sidebar-group-label">Suivi</span>
            <NavigationLink to="/summary" label="Résumé" icon="summary" />
            <NavigationLink to="/tournaments" label="Tournois" icon="tournaments" />
            <NavigationLink to="/bankroll" label="Bankroll" icon="bankroll" />
          </div>
          <div className="sidebar-group">
            <span className="sidebar-group-label">Review</span>
            <NavigationLink to="/review" label="Mains à revoir" icon="review" />
          </div>
          <div className="sidebar-group">
            <span className="sidebar-group-label">Analyses</span>
            <NavigationLink to="/advanced" label="Analyses avancées" icon="analysis" />
          </div>
          <div className="sidebar-group">
            <span className="sidebar-group-label">Données</span>
            <NavigationLink to="/import" label="Import" icon="import" />
          </div>
        </nav>
        <main className="content">
          <Routes>
            <Route path="/" element={<Navigate to="/summary" replace />} />
            <Route path="/import" element={<Import />} />
            <Route path="/tournaments" element={<Tournaments />} />
            <Route path="/summary" element={<Summary />} />
            <Route path="/review" element={<ReviewQueue />} />
            <Route path="/advanced/*" element={<Advanced />} />
            <Route path="/short-stack" element={<Navigate to="/advanced/short-stack" replace />} />
            <Route path="/hitting-board" element={<Navigate to="/advanced/flops" replace />} />
            <Route path="/gto" element={<Navigate to="/advanced/ranges" replace />} />
            <Route path="/bankroll" element={<Bankroll />} />
            <Route path="/tournaments/:id/hands" element={<HandList />} />
            <Route path="/tournaments/:id/replay" element={<Replayer />} />
            <Route path="/hands/:handId" element={<HandDetail />} />
            <Route path="/hands/:handId/replay" element={<Replayer />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
