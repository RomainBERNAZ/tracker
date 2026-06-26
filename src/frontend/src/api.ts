import { invoke } from '@tauri-apps/api/core'

function invokeTauri<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const hasTauriRuntime =
    globalThis.window !== undefined &&
    (globalThis.window as typeof globalThis.window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== undefined

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
  hero_net_ev_eur_sum: number
  wsd_cev_sum: number
  sd_cev_sum: number
}

export interface HandRow {
  id: string
  tournament_id: string
  level: number
  small_blind: number
  big_blind: number
  timestamp: string
  hero_cev: number
  hero_collected: number
  hero_net_ev: number | null
  hero_allin_equity: number | null
  hero_cards: string | null
  total_pot: number
  seat_count: number
  invariants_ok: boolean
  hero_net_ev_eur: number | null
  has_showdown: boolean | null
  hero_showed: boolean | null
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

export interface ChipSummary {
  net_chips: number
  net_ev_chips: number
  avg_cev_per_game: number
  wsd_net_chips: number
  sd_net_chips: number
}

export interface ReplayerPlayer {
  seat_number: number
  name: string
  hero: boolean
  starting_stack: number
  current_stack: number
  hole_cards: string | null
  folded: boolean
}

export interface ReplayerStep {
  step_number: number
  street: string
  actor_name: string
  action_type: string
  amount: number | null
  increment_amount: number | null
  to_amount: number | null
  pot_size_after: number
  players_after: ReplayerPlayer[]
  description: string
}

export interface ReplayerState {
  hand_id: string
  tournament_id: string
  table_name: string
  timestamp: string
  level: number
  small_blind: number
  big_blind: number
  players: ReplayerPlayer[]
  button_pos: number
  board: string[]
  current_step: number
  total_steps: number
  steps: ReplayerStep[]
}

export interface HandChipPoint {
  timestamp: string
  realized_cev: number
  net_ev: number | null
  has_showdown: boolean
}

export interface CoachSpot {
  hand_id: string
  tournament_id: string
  timestamp: string
  delta_chips: number
  has_showdown: boolean
  severity: 'low' | 'medium' | 'high'
  reason: string
}

export interface CoachFormatStats {
  hands: number
  vpip_count: number
  vpip_pct: number
  pfr_count: number
  pfr_pct: number
  three_bet_count: number
  three_bet_opportunities: number
  three_bet_pct: number
  limp_count: number
  limp_pct: number
  fold_to_three_bet_count: number
  fold_to_three_bet_opportunities: number
  fold_to_three_bet_pct: number
  feedback: string[]
}

export interface CoachStatsSnapshot {
  early_phase: CoachFormatStats
  mid_phase: CoachFormatStats
  late_phase: CoachFormatStats
  heads_up: CoachFormatStats
}

export interface CoachBlunderSpot {
  hand_id: string
  tournament_id: string
  timestamp: string
  level: number
  big_blind: number
  action_kind: 'call' | 'push'
  action_type: string
  hero_stack_bb: number
  action_amount_bb: number
  net_ev_chips: number
  net_ev_bb: number
  allin_equity: number | null
  has_showdown: boolean
  severity: 'bad' | 'critical'
  reason: string
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
  moveWindowToPrimary: (): Promise<void> =>
    invokeTauri('move_window_to_primary'),

  pickImportFile: (defaultDir?: string | null): Promise<string | null> =>
    invokeTauri('pick_import_file', { defaultDir }),

  pickImportFiles: (defaultDir?: string | null): Promise<string[] | null> =>
    invokeTauri('pick_import_files', { defaultDir }),

  pickImportFolder: (defaultDir?: string | null): Promise<string | null> =>
    invokeTauri('pick_import_folder', { defaultDir }),

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

  getHandForReplay: (handId: string): Promise<ReplayerState | null> =>
    invokeTauri('get_hand_for_replay', { handId }),

  getStats: (): Promise<SessionStats> =>
    invokeTauri('get_stats'),

  getChipSummary: (): Promise<ChipSummary> =>
    invokeTauri('get_chip_summary_cmd'),

  getChipEvolution: (): Promise<HandChipPoint[]> =>
    invokeTauri('get_chip_evolution_cmd'),

  getCoachSpots: (limit?: number): Promise<CoachSpot[]> =>
    invokeTauri('get_coach_spots', { limit }),

  getCoachStats: (fromTs?: string | null, toTs?: string | null): Promise<CoachStatsSnapshot> =>
    invokeTauri('get_coach_stats_cmd', { fromTs, toTs }),

  getCoachBlunders: (
    fromTs?: string | null,
    toTs?: string | null,
    limit?: number,
    minSeverity?: 'bad' | 'critical' | null,
  ): Promise<CoachBlunderSpot[]> =>
    invokeTauri('get_coach_blunders_cmd', { fromTs, toTs, limit, minSeverity }),

  clearAllData: (): Promise<ClearDataResult> =>
    invokeTauri('clear_all_data'),
}
