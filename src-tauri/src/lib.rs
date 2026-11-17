use std::sync::Mutex;
use std::path::{Path, PathBuf};
use serde::Serialize;

use hh_ingest::{db, import_history_file_with_conn, ImportProgress, ImportResult, DEFAULT_HERO};
use hh_ingest::bankroll::{self, BankrollSettings, BankrollSnapshot, MovementKind};
use rusqlite::Connection;
use session_read_model::stacks::{get_stack_stats, StackStatsSnapshot};
use session_read_model::{
	list_preflop_matchups, PreflopMatchup,
	get_hand_detail, get_session_stats, get_chip_summary, get_chip_evolution, get_coach_stats, list_coach_spots, list_coach_blunders,
	list_hands_for_tournament, list_tournaments, get_gto_ranges,
	HandDetail, HandRow, HandChipPoint, SessionStats, ChipSummary, TournamentRow, CoachSpot, CoachStatsSnapshot, CoachBlunderSpot,
	load_hand_for_replay, ReplayerState, GtoRange,
};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

fn move_window_to_primary_center(window: &tauri::WebviewWindow) -> Result<(), String> {
	let monitor = window
		.primary_monitor()
		.map_err(|e| e.to_string())?
		.ok_or_else(|| "Aucun ecran principal detecte".to_string())?;

	let monitor_size = monitor.size();
	let monitor_pos = monitor.position();
	let window_size = window.outer_size().map_err(|e| e.to_string())?;

	let monitor_width = monitor_size.width as i32;
	let monitor_height = monitor_size.height as i32;
	let window_width = (window_size.width as i32).min(monitor_width);
	let window_height = (window_size.height as i32).min(monitor_height);

	// Center the window, but ensure it stays within bounds
	let x = monitor_pos.x + ((monitor_width - window_width) / 2).max(0);
	let y = monitor_pos.y + ((monitor_height - window_height) / 2).max(0);

	window
		.set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(x, y)))
		.map_err(|e| e.to_string())
}

pub struct AppState {
	pub db: Mutex<Connection>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BatchImportResult {
	pub tournaments_total: usize,
	pub tournaments_imported: usize,
	pub tournaments_failed: usize,
	pub total_hands: usize,
	pub inserted_hands: usize,
	pub skipped_hands: usize,
	pub parse_errors: usize,
	pub invalid_hands: usize,
	pub failures: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ClearDataResult {
	pub tournaments: i64,
	pub hands: i64,
	pub hand_players: i64,
	pub hand_actions: i64,
	pub hole_cards: i64,
	pub invariant_checks: i64,
	pub import_sessions: i64,
}

fn derive_pair_from_selected(selected: &Path) -> Result<(PathBuf, PathBuf), String> {
	let name = selected
		.file_name()
		.and_then(|n| n.to_str())
		.ok_or_else(|| "Nom de fichier invalide".to_string())?;

	if name.to_ascii_lowercase().ends_with(".zip") {
		return Ok((selected.to_path_buf(), PathBuf::new()));
	}

	if name.to_ascii_lowercase().ends_with("_summary.txt") {
		let base = &name[..name.len() - "_summary.txt".len()];
		let hh_name = format!("{base}.txt");
		let hh_path = selected.with_file_name(hh_name);
		return Ok((hh_path, selected.to_path_buf()));
	}

	if name.to_ascii_lowercase().ends_with(".txt") {
		let stem = selected
			.file_stem()
			.and_then(|stem| stem.to_str())
			.ok_or_else(|| "Nom de fichier invalide".to_string())?;
		let summary_name = format!("{stem}_summary.txt");
		let summary_path = selected.with_file_name(summary_name);
		return Ok((selected.to_path_buf(), summary_path));
	}

	Err("Fichier non supporte: utiliser .txt, .zip ou _summary.txt".to_string())
}

pub mod commands {
	use super::*;

	fn apply_default_directory(
		builder: tauri_plugin_dialog::FileDialogBuilder<tauri::Wry>,
		default_dir: Option<String>,
	) -> tauri_plugin_dialog::FileDialogBuilder<tauri::Wry> {
		if let Some(dir) = default_dir {
			if !dir.trim().is_empty() {
				return builder.set_directory(dir);
			}
		}
		builder
	}

	#[tauri::command]
	pub async fn pick_import_file(
		default_dir: Option<String>,
		window: tauri::WebviewWindow,
	) -> Result<Option<String>, String> {
		let _ = move_window_to_primary_center(&window);

		let builder = window
			.dialog()
			.file()
			.set_parent(&window)
			.set_title("Selectionner un fichier Winamax ou Betclic")
			.add_filter("Hand History", &["txt", "zip"]);

		let selected = apply_default_directory(builder, default_dir).blocking_pick_file();
		Ok(selected.map(|p| p.to_string()))
	}

	#[tauri::command]
	pub async fn pick_import_files(
		default_dir: Option<String>,
		window: tauri::WebviewWindow,
	) -> Result<Option<Vec<String>>, String> {
		let _ = move_window_to_primary_center(&window);

		let builder = window
			.dialog()
			.file()
			.set_parent(&window)
			.set_title("Selectionner plusieurs fichiers Winamax ou Betclic")
			.add_filter("Hand History", &["txt", "zip"]);

		let selected = apply_default_directory(builder, default_dir).blocking_pick_files();
		Ok(selected.map(|files| files.into_iter().map(|p| p.to_string()).collect()))
	}

	#[tauri::command]
	pub async fn pick_import_folder(
		default_dir: Option<String>,
		window: tauri::WebviewWindow,
	) -> Result<Option<String>, String> {
		let _ = move_window_to_primary_center(&window);

		let builder = window
			.dialog()
			.file()
			.set_parent(&window)
			.set_title("Selectionner le dossier d imports Winamax ou Betclic");

		let selected = apply_default_directory(builder, default_dir).blocking_pick_folder();
		Ok(selected.map(|p| p.to_string()))
	}

	#[tauri::command]
	pub async fn import_tournament(
		hh_path: String,
		summary_path: String,
		state: tauri::State<'_, AppState>,
		window: tauri::Window,
	) -> Result<ImportResult, String> {
		let selected_hh = Path::new(&hh_path);
		let selected_summary = Path::new(&summary_path);
		let selected_is_summary = selected_hh
			.file_name()
			.and_then(|name| name.to_str())
			.is_some_and(|name| name.to_ascii_lowercase().ends_with("_summary.txt"));
		let (effective_hh, derived_summary) = if selected_is_summary || !selected_hh.exists() {
			derive_pair_from_selected(selected_hh)?
		} else {
			(selected_hh.to_path_buf(), PathBuf::new())
		};

		if !effective_hh.is_file() {
			return Err(format!("IO error: fichier HH introuvable: {}", effective_hh.display()));
		}
		let effective_summary = if selected_summary.is_file() {
			Some(selected_summary.to_path_buf())
		} else if !derived_summary.as_os_str().is_empty() && derived_summary.is_file() {
			Some(derived_summary)
		} else {
			derive_pair_from_selected(&effective_hh)
				.ok()
				.map(|(_, summary)| summary)
				.filter(|summary| summary.is_file())
		};
		let effective_summary = effective_summary
			.map(|path| path.to_string_lossy().into_owned());

		let conn = state.db.lock().map_err(|e| e.to_string())?;
		let win = window.clone();

		let result = import_history_file_with_conn(
			effective_hh.to_string_lossy().as_ref(),
			effective_summary.as_deref(),
			&conn,
			DEFAULT_HERO,
			Some(Box::new(move |progress: ImportProgress| {
				let _ = win.emit("import_progress", &progress);
			})),
		)
		.map_err(|e| e.to_string())?;

		Ok(result)
	}

	#[tauri::command]
	pub async fn import_folder(
		folder_path: String,
		state: tauri::State<'_, AppState>,
		window: tauri::Window,
	) -> Result<BatchImportResult, String> {
		let base = Path::new(&folder_path);
		if !base.is_dir() {
			return Err(format!("Dossier invalide: {}", folder_path));
		}

		let mut hh_files: Vec<PathBuf> = std::fs::read_dir(base)
			.map_err(|e| e.to_string())?
			.filter_map(Result::ok)
			.map(|e| e.path())
			.filter(|p| {
				let extension = p
					.extension()
					.and_then(|e| e.to_str())
					.unwrap_or_default()
					.to_ascii_lowercase();
				let file_name = p
					.file_name()
					.and_then(|n| n.to_str())
					.unwrap_or_default()
					.to_ascii_lowercase();
				p.is_file()
					&& (extension == "txt" || extension == "zip")
					&& !file_name.ends_with("_summary.txt")
			})
			.collect();
		hh_files.sort();

		if hh_files.is_empty() {
			return Err("Aucun fichier .txt ou .zip de tournoi trouve dans ce dossier".to_string());
		}

		let conn = state.db.lock().map_err(|e| e.to_string())?;
		let win = window.clone();

		let mut total_hands = 0usize;
		let mut inserted_hands = 0usize;
		let mut skipped_hands = 0usize;
		let mut parse_errors = 0usize;
		let mut invalid_hands = 0usize;
		let mut imported = 0usize;
		let mut failed = 0usize;
		let mut failures: Vec<String> = Vec::new();

		for hh in &hh_files {
			let is_text = hh
				.extension()
				.and_then(|extension| extension.to_str())
				.is_some_and(|extension| extension.eq_ignore_ascii_case("txt"));
			let summary_path = if is_text {
				let stem = hh.file_stem().and_then(|name| name.to_str()).unwrap_or_default();
				let summary = hh.with_file_name(format!("{stem}_summary.txt"));
				summary.is_file().then_some(summary)
			} else {
				None
			};
			let summary_path =
				summary_path.map(|path| path.to_string_lossy().into_owned());

			match import_history_file_with_conn(
				hh.to_string_lossy().as_ref(),
				summary_path.as_deref(),
				&conn,
				DEFAULT_HERO,
				Some(Box::new({
					let win = win.clone();
					move |progress: ImportProgress| {
						let _ = win.emit("import_progress", &progress);
					}
				})),
			) {
				Ok(res) => {
					imported += 1;
					total_hands += res.total_hands;
					inserted_hands += res.inserted_hands;
					skipped_hands += res.skipped_hands;
					parse_errors += res.parse_errors;
					invalid_hands += res.invalid_hands;
				}
				Err(e) => {
					failed += 1;
					failures.push(format!(
						"{}: {}",
						hh.file_name().and_then(|n| n.to_str()).unwrap_or_default(),
						e
					));
				}
			}
		}

		Ok(BatchImportResult {
			tournaments_total: hh_files.len(),
			tournaments_imported: imported,
			tournaments_failed: failed,
			total_hands,
			inserted_hands,
			skipped_hands,
			parse_errors,
			invalid_hands,
			failures,
		})
	}

	#[tauri::command]
	pub async fn get_bankroll(state: tauri::State<'_, AppState>) -> Result<Option<BankrollSnapshot>, String> {
		let conn = state.db.lock().map_err(|e| e.to_string())?;
		bankroll::get_bankroll(&conn).map_err(|e| e.to_string())
	}

	#[tauri::command]
	pub async fn initialize_bankroll(
		amount_cents: i64,
		state: tauri::State<'_, AppState>,
	) -> Result<BankrollSnapshot, String> {
		let conn = state.db.lock().map_err(|e| e.to_string())?;
		bankroll::initialize_bankroll(&conn, amount_cents).map_err(|e| e.to_string())
	}

	#[tauri::command]
	pub async fn record_bankroll_movement(
		kind: MovementKind,
		amount_cents: i64,
		note: String,
		state: tauri::State<'_, AppState>,
	) -> Result<BankrollSnapshot, String> {
		let conn = state.db.lock().map_err(|e| e.to_string())?;
		bankroll::record_movement(&conn, kind, amount_cents, &note).map_err(|e| e.to_string())
	}

	#[tauri::command]
	pub async fn save_bankroll_settings(
		settings: BankrollSettings,
		state: tauri::State<'_, AppState>,
	) -> Result<BankrollSnapshot, String> {
		let conn = state.db.lock().map_err(|e| e.to_string())?;
		bankroll::save_settings(&conn, &settings).map_err(|e| e.to_string())
	}

	#[tauri::command]
	pub async fn get_tournaments(
		limit: Option<usize>,
		offset: Option<usize>,
		state: tauri::State<'_, AppState>,
	) -> Result<Vec<TournamentRow>, String> {
		let conn = state.db.lock().map_err(|e| e.to_string())?;
		list_tournaments(&conn, limit, offset).map_err(|e| e.to_string())
	}

	#[tauri::command]
	pub async fn get_hands_for_tournament(
		tournament_id: String,
		state: tauri::State<'_, AppState>,
	) -> Result<Vec<HandRow>, String> {
		let conn = state.db.lock().map_err(|e| e.to_string())?;
		list_hands_for_tournament(&conn, &tournament_id).map_err(|e| e.to_string())
	}

	#[tauri::command]
	pub async fn get_hand(
		hand_id: String,
		state: tauri::State<'_, AppState>,
	) -> Result<Option<HandDetail>, String> {
		let conn = state.db.lock().map_err(|e| e.to_string())?;
		get_hand_detail(&conn, &hand_id).map_err(|e| e.to_string())
	}

	#[tauri::command]
	pub async fn get_hand_for_replay(
		hand_id: String,
		state: tauri::State<'_, AppState>,
	) -> Result<Option<ReplayerState>, String> {
		let conn = state.db.lock().map_err(|e| e.to_string())?;
		load_hand_for_replay(&conn, &hand_id).map_err(|e| e.to_string())
	}

	#[tauri::command]
	pub async fn get_stats(state: tauri::State<'_, AppState>) -> Result<SessionStats, String> {
		let conn = state.db.lock().map_err(|e| e.to_string())?;
		get_session_stats(&conn).map_err(|e| e.to_string())
	}

	#[tauri::command]
	pub async fn get_chip_evolution_cmd(
		state: tauri::State<'_, AppState>,
	) -> Result<Vec<HandChipPoint>, String> {
		let conn = state.db.lock().map_err(|e| e.to_string())?;
		get_chip_evolution(&conn).map_err(|e| e.to_string())
	}

	#[tauri::command]
	pub async fn get_preflop_matchups(
		state: tauri::State<'_, AppState>,
	) -> Result<Vec<PreflopMatchup>, String> {
		let conn = state.db.lock().map_err(|e| e.to_string())?;
		list_preflop_matchups(&conn).map_err(|e| e.to_string())
	}

	#[tauri::command]
	pub async fn get_chip_summary_cmd(state: tauri::State<'_, AppState>) -> Result<ChipSummary, String> {
		let conn = state.db.lock().map_err(|e| e.to_string())?;
		get_chip_summary(&conn).map_err(|e| e.to_string())
	}

	#[tauri::command]
	pub async fn get_coach_spots(
		limit: Option<usize>,
		state: tauri::State<'_, AppState>,
	) -> Result<Vec<CoachSpot>, String> {
		let conn = state.db.lock().map_err(|e| e.to_string())?;
		list_coach_spots(&conn, limit).map_err(|e| e.to_string())
	}

	#[tauri::command]
	pub async fn get_stack_stats_cmd(
		tournament_ids: Vec<String>,
		state: tauri::State<'_, AppState>,
	) -> Result<StackStatsSnapshot, String> {
		let conn = state.db.lock().map_err(|e| e.to_string())?;
		get_stack_stats(&conn, &tournament_ids).map_err(|e| e.to_string())
	}

	#[tauri::command]
	pub async fn get_coach_stats_cmd(
		from_ts: Option<String>,
		to_ts: Option<String>,
		buy_ins: Vec<f64>,
		state: tauri::State<'_, AppState>,
	) -> Result<CoachStatsSnapshot, String> {
		let conn = state.db.lock().map_err(|e| e.to_string())?;
		get_coach_stats(&conn, from_ts.as_deref(), to_ts.as_deref(), &buy_ins).map_err(|e| e.to_string())
	}

	#[tauri::command]
	pub async fn get_coach_blunders_cmd(
		from_ts: Option<String>,
		to_ts: Option<String>,
		limit: Option<usize>,
		min_severity: Option<String>,
		buy_ins: Vec<f64>,
		state: tauri::State<'_, AppState>,
	) -> Result<Vec<CoachBlunderSpot>, String> {
		let conn = state.db.lock().map_err(|e| e.to_string())?;
		list_coach_blunders(&conn, from_ts.as_deref(), to_ts.as_deref(), limit, min_severity.as_deref(), &buy_ins)
			.map_err(|e| e.to_string())
	}

	#[tauri::command]
	pub async fn get_gto_ranges_cmd() -> Result<Vec<GtoRange>, String> {
		Ok(get_gto_ranges())
	}

	#[tauri::command]
	pub async fn move_window_to_primary(window: tauri::WebviewWindow) -> Result<(), String> {
		move_window_to_primary_center(&window)
	}

	#[tauri::command]
	pub async fn clear_all_data(state: tauri::State<'_, AppState>) -> Result<ClearDataResult, String> {
		let conn = state.db.lock().map_err(|e| e.to_string())?;
		let cleared = db::clear_all_imported_data(&conn).map_err(|e| e.to_string())?;
		Ok(ClearDataResult {
			tournaments: cleared.tournaments,
			hands: cleared.hands,
			hand_players: cleared.hand_players,
			hand_actions: cleared.hand_actions,
			hole_cards: cleared.hole_cards,
			invariant_checks: cleared.invariant_checks,
			import_sessions: cleared.import_sessions,
		})
	}
}

pub fn run() {
	tauri::Builder::default()
		.plugin(tauri_plugin_dialog::init())
		.setup(|app| {
			let app_dir = app
				.path()
				.app_data_dir()
				.expect("failed to get app data dir");
			std::fs::create_dir_all(&app_dir)?;
			let db_path = app_dir.join("expresso.db");

			let conn = db::open(db_path.to_str().unwrap()).expect("failed to open/create database");

			app.manage(AppState {
				db: Mutex::new(conn),
			});

			// Let window manager handle positioning
			// if let Some(main_window) = app.get_webview_window("main") {
			// 	let _ = move_window_to_primary_center(&main_window);
			// }

			Ok(())
		})
		.invoke_handler(tauri::generate_handler![
			commands::move_window_to_primary,
			commands::pick_import_file,
			commands::pick_import_files,
			commands::pick_import_folder,
			commands::import_tournament,
			commands::import_folder,
			commands::get_tournaments,
			commands::get_bankroll,
			commands::initialize_bankroll,
			commands::record_bankroll_movement,
			commands::save_bankroll_settings,
			commands::get_hands_for_tournament,
			commands::get_hand,
			commands::get_hand_for_replay,
			commands::get_stats,
			commands::get_chip_summary_cmd,
			commands::get_chip_evolution_cmd,
			commands::get_preflop_matchups,
			commands::get_coach_spots,
			commands::get_coach_stats_cmd,
			commands::get_stack_stats_cmd,
			commands::get_coach_blunders_cmd,
			commands::get_gto_ranges_cmd,
			commands::clear_all_data,
		])
		.run(tauri::generate_context!())
		.expect("error while running Tauri application");
}
