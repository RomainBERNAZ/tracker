use std::sync::Mutex;
use std::path::{Path, PathBuf};
use serde::Serialize;

use hh_ingest::{db, import_tournament_with_conn, ImportProgress, ImportResult, DEFAULT_HERO};
use rusqlite::Connection;
use session_read_model::{
	get_hand_detail, get_session_stats, get_chip_summary, get_chip_evolution, get_coach_stats, list_coach_spots, list_coach_blunders,
	list_hands_for_tournament, list_tournaments,
	HandDetail, HandRow, HandChipPoint, SessionStats, ChipSummary, TournamentRow, CoachSpot, CoachStatsSnapshot, CoachBlunderSpot,
	load_hand_for_replay, ReplayerState,
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

	let monitor_width = i32::try_from(monitor_size.width).unwrap_or(i32::MAX);
	let monitor_height = i32::try_from(monitor_size.height).unwrap_or(i32::MAX);
	let window_width = i32::try_from(window_size.width).unwrap_or(i32::MAX);
	let window_height = i32::try_from(window_size.height).unwrap_or(i32::MAX);

	let x = monitor_pos.x + ((monitor_width - window_width).max(0) / 2);
	let y = monitor_pos.y + ((monitor_height - window_height).max(0) / 2);

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

	if name.ends_with("_summary.txt") {
		let hh_name = name.replace("_summary.txt", ".txt");
		let hh_path = selected.with_file_name(hh_name);
		return Ok((hh_path, selected.to_path_buf()));
	}

	if name.ends_with(".txt") {
		let summary_name = name.replace(".txt", "_summary.txt");
		let summary_path = selected.with_file_name(summary_name);
		return Ok((selected.to_path_buf(), summary_path));
	}

	Err("Fichier non supporte: utiliser .txt ou _summary.txt".to_string())
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
			.set_title("Selectionner le fichier HH Winamax")
			.add_filter("Hand History", &["txt"]);

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
			.set_title("Selectionner plusieurs fichiers Winamax (.txt)")
			.add_filter("Hand History", &["txt"]);

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
			.set_title("Selectionner le dossier d imports Winamax");

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
		let (effective_hh, effective_summary) = if selected_hh.exists() && selected_summary.exists() {
			(selected_hh.to_path_buf(), selected_summary.to_path_buf())
		} else {
			derive_pair_from_selected(selected_hh)?
		};

		if !effective_hh.exists() {
			return Err(format!("IO error: fichier HH introuvable: {}", effective_hh.display()));
		}
		if !effective_summary.exists() {
			return Err(format!(
				"IO error: fichier summary introuvable: {}",
				effective_summary.display()
			));
		}

		let conn = state.db.lock().map_err(|e| e.to_string())?;
		let win = window.clone();

		let result = import_tournament_with_conn(
			effective_hh.to_string_lossy().as_ref(),
			effective_summary.to_string_lossy().as_ref(),
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
				p.is_file()
					&& p.extension().and_then(|e| e.to_str()) == Some("txt")
					&& !p
						.file_name()
						.and_then(|n| n.to_str())
						.unwrap_or_default()
						.ends_with("_summary.txt")
			})
			.collect();
		hh_files.sort();

		if hh_files.is_empty() {
			return Err("Aucun fichier .txt de tournoi trouve dans ce dossier".to_string());
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
			let summary = hh.with_file_name(
				hh.file_name()
					.and_then(|n| n.to_str())
					.unwrap_or_default()
					.replace(".txt", "_summary.txt"),
			);

			if !summary.exists() {
				failed += 1;
				failures.push(format!(
					"Summary manquant pour {}",
					hh.file_name().and_then(|n| n.to_str()).unwrap_or_default()
				));
				continue;
			}

			match import_tournament_with_conn(
				hh.to_string_lossy().as_ref(),
				summary.to_string_lossy().as_ref(),
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
	pub async fn get_coach_stats_cmd(
		from_ts: Option<String>,
		to_ts: Option<String>,
		state: tauri::State<'_, AppState>,
	) -> Result<CoachStatsSnapshot, String> {
		let conn = state.db.lock().map_err(|e| e.to_string())?;
		get_coach_stats(&conn, from_ts.as_deref(), to_ts.as_deref()).map_err(|e| e.to_string())
	}

	#[tauri::command]
	pub async fn get_coach_blunders_cmd(
		from_ts: Option<String>,
		to_ts: Option<String>,
		limit: Option<usize>,
		min_severity: Option<String>,
		state: tauri::State<'_, AppState>,
	) -> Result<Vec<CoachBlunderSpot>, String> {
		let conn = state.db.lock().map_err(|e| e.to_string())?;
		list_coach_blunders(&conn, from_ts.as_deref(), to_ts.as_deref(), limit, min_severity.as_deref())
			.map_err(|e| e.to_string())
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

			if let Some(main_window) = app.get_webview_window("main") {
				let _ = move_window_to_primary_center(&main_window);
			}

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
			commands::get_hands_for_tournament,
			commands::get_hand,
			commands::get_hand_for_replay,
			commands::get_stats,
			commands::get_chip_summary_cmd,
			commands::get_chip_evolution_cmd,
			commands::get_coach_spots,
			commands::get_coach_stats_cmd,
			commands::get_coach_blunders_cmd,
			commands::clear_all_data,
		])
		.run(tauri::generate_context!())
		.expect("error while running Tauri application");
}
