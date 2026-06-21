import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import Import from './pages/Import'
import Tournaments from './pages/Tournaments'
import HandList from './pages/HandList'
import HandDetail from './pages/HandDetail'
import './App.css'

export default function App() {
  return (
    <BrowserRouter>
      <div className="layout">
        <nav className="sidebar">
          <div className="sidebar-title">Expresso<br /><span>Review</span></div>
          <NavLink to="/" end className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
            ↑ Import
          </NavLink>
          <NavLink to="/tournaments" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
            ☰ Tournois
          </NavLink>
        </nav>
        <main className="content">
          <Routes>
            <Route path="/" element={<Import />} />
            <Route path="/tournaments" element={<Tournaments />} />
            <Route path="/tournaments/:id/hands" element={<HandList />} />
            <Route path="/hands/:handId" element={<HandDetail />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
