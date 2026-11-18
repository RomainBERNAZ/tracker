import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import ShortStackAnalysis from './ShortStackAnalysis'
import HittingBoard from './HittingBoard'

export default function Advanced() {
  return <div>
    <div className="page-header"><h1>Advanced</h1></div>
    <nav className="advanced-tabs" aria-label="Analyses avancées">
      <NavLink to="/advanced/short-stack">Jeu short-stack</NavLink>
      <NavLink to="/advanced/flops">Connexion au flop</NavLink>
    </nav>
    <Routes>
      <Route index element={<Navigate to="short-stack" replace />} />
      <Route path="short-stack" element={<ShortStackAnalysis />} />
      <Route path="flops" element={<HittingBoard />} />
    </Routes>
  </div>
}
