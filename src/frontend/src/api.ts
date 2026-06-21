import { invoke } from '@tauri-apps/api/core'

function invokeTauri<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const hasTauriRuntime =
    typeof window !== 'undefined' &&
    typeof (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== 'undefined'

  if (!hasTauriRuntime) {
    return Promise.reject(
      new Error(
        "Cette interface doit etre ouverte dans l'application desktop Tauri (pas directement dans le navigateur). Lance './dev'.",
      ),
    )
  }

  return invoke<T>(cmd, args)
}

// ─── Types mirroring Rust read models ────────────────────────────────────────

export interface TournamentRow {
  id: string
  player_name: string
  buy_in_euros: number
  prizepool_euros: number
  multiplier: number
  finish_position: number
  started_at: string
  duration_secs: number
  net_eur: number
  hand_count: number
  hero_cev_sum: number
}

export interface HandRow {
  id: string
  tournament_id: string
  level: number
  small_blind: number
  big_blind: number
  timestamp: string
  hero_cev: number
  hero_net_ev: number | null
  hero_allin_equity: number | null
  hero_cards: string | null
  total_pot: number
  seat_count: number
  invariants_ok: boolean
}

export interface PlayerDetailRow {
  seat_number: number
  player_name: string
  starting_stack: number
  ending_stack: number
  contributions: number
  collected: number
  realized_cev: number
  net_ev: number | null
  allin_equity: number | null
  hero: boolean
  hole_cards: string | null
}

export interface ActionRow {
  street: string
  action_index: number
  player_name: string
  action_type: string
  amount: number | null
  increment_amount: number | null
  to_amount: number | null
}

export interface HandDetail {
  hand: HandRow
  players: PlayerDetailRow[]
  actions: ActionRow[]
}

export interface SessionStats {
  total_tournaments: number
  total_hands: number
  total_net_eur: number
  avg_net_eur_per_tournament: number
  wins: number
  second_place: number
  third_place: number
  multiplier_dist: [number, number][]
}

export interface ImportResult {
  session_id: string
  total_hands: number
  inserted_hands: number
  skipped_hands: number
  parse_errors: number
  invalid_hands: number
}

export interface BatchImportResult {
  tournaments_total: number
  tournaments_imported: number
  tournaments_failed: number
  total_hands: number
  inserted_hands: number
  skipped_hands: number
  parse_errors: number
  invalid_hands: number
  failures: string[]
}

export interface ImportProgress {
  session_id: string
  total_hands: number
  processed_hands: number
  inserted_hands: number
  skipped_hands: number
  parse_errors: number
  invalid_hands: number
  warnings: string[]
  done: boolean
  error: string | null
}

export interface ClearDataResult {
  tournaments: number
  hands: number
  hand_players: number
  hand_actions: number
  hole_cards: number
  invariant_checks: number
  import_sessions: number
}

// ─── API calls ────────────────────────────────────────────────────────────────

export const api = {
  importTournament: (hhPath: string, summaryPath: string): Promise<ImportResult> =>
    invokeTauri('import_tournament', { hhPath, summaryPath }),

  importFolder: (folderPath: string): Promise<BatchImportResult> =>
    invokeTauri('import_folder', { folderPath }),

  getTournaments: (limit?: number, offset?: number): Promise<TournamentRow[]> =>
    invokeTauri('get_tournaments', { limit, offset }),

  getHandsForTournament: (tournamentId: string): Promise<HandRow[]> =>
    invokeTauri('get_hands_for_tournament', { tournamentId }),

  getHand: (handId: string): Promise<HandDetail | null> =>
    invokeTauri('get_hand', { handId }),

  getStats: (): Promise<SessionStats> =>
    invokeTauri('get_stats'),

  clearAllData: (): Promise<ClearDataResult> =>
    invokeTauri('clear_all_data'),
}
