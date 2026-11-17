import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom'
import Import from './pages/Import'
import Tournaments from './pages/Tournaments'
import HandList from './pages/HandList'
import HandDetail from './pages/HandDetail'
import Replayer from './pages/Replayer'
import Summary from './pages/Summary'
import GtoCharts from './pages/GtoCharts'
import Bankroll from './pages/Bankroll'
import { api } from './api'
import './App.css'

export default function App() {
  useEffect(() => {
    api.moveWindowToPrimary().catch(() => undefined)
  }, [])

  return (
    <BrowserRouter>
      <div className="layout">
        <nav className="sidebar">
          <div className="sidebar-title">Expresso<br /><span>Review</span></div>
          <NavLink to="/summary" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
            ◉ Summary
          </NavLink>
          <NavLink to="/tournaments" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
            ☰ Tournois
          </NavLink>
          <NavLink to="/bankroll" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
            € Bankroll
          </NavLink>
          <NavLink to="/gto" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
            ♠ GTO (expérimental)
          </NavLink>
          <NavLink to="/import" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
            ↑ Import
          </NavLink>
        </nav>
        <main className="content">
          <Routes>
            <Route path="/" element={<Navigate to="/summary" replace />} />
            <Route path="/import" element={<Import />} />
            <Route path="/tournaments" element={<Tournaments />} />
            <Route path="/summary" element={<Summary />} />
            <Route path="/gto" element={<GtoCharts />} />
            <Route path="/bankroll" element={<Bankroll />} />
            <Route path="/tournaments/:id/hands" element={<HandList />} />
            <Route path="/hands/:handId" element={<HandDetail />} />
            <Route path="/hands/:handId/replay" element={<Replayer />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
