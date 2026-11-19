import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import ShortStackAnalysis from './ShortStackAnalysis'
import HittingBoard from './HittingBoard'
import MatchupAnalysis from './MatchupAnalysis'
import GtoCharts from './GtoCharts'

export default function Advanced() {
  return <div>
    <div className="page-header"><h1>Analyses avancées</h1><p>Des outils de review ciblés, à interpréter avec leurs échantillons.</p></div>
    <nav className="advanced-tabs" aria-label="Analyses avancées">
      <NavLink to="/advanced/short-stack">Jeu short-stack</NavLink>
      <NavLink to="/advanced/flops">Connexion au flop</NavLink>
      <NavLink to="/advanced/confrontations">Confrontations</NavLink>
      <NavLink to="/advanced/ranges">Ranges exploratoires</NavLink>
    </nav>
    <Routes>
      <Route index element={<Navigate to="short-stack" replace />} />
      <Route path="short-stack" element={<ShortStackAnalysis />} />
      <Route path="flops" element={<HittingBoard />} />
      <Route path="confrontations" element={<MatchupAnalysis />} />
      <Route path="ranges" element={<GtoCharts />} />
    </Routes>
  </div>
}
