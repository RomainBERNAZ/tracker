use std::sync::Mutex;
use std::path::{Path, PathBuf};
use serde::Serialize;

use hh_ingest::{db, import_tournament_with_conn, ImportProgress, ImportResult, DEFAULT_HERO};
use rusqlite::Connection;
use session_read_model::{
	get_hand_detail, get_session_stats, list_hands_for_tournament, list_tournaments, HandDetail,
	HandRow, SessionStats, TournamentRow, load_hand_for_replay, ReplayerState,
};
use tauri::{Emitter, Manager};

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

			Ok(())
		})
		.invoke_handler(tauri::generate_handler![
			commands::import_tournament,
			commands::import_folder,
			commands::get_tournaments,
			commands::get_hands_for_tournament,
			commands::get_hand,
			commands::get_hand_for_replay,
			commands::get_stats,
			commands::clear_all_data,
		])
		.run(tauri::generate_context!())
		.expect("error while running Tauri application");
}
