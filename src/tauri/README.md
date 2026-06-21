# src/tauri — Desktop Shell

Tauri application shell & IPC handlers.

## Structure

```
src/tauri/
├── src/
│   ├── main.rs              # Tauri window setup
│   ├── commands/            # IPC handlers
│   │   ├── import.rs        # import_hand_history
│   │   ├── queries.rs       # get_sessions, get_hand_detail
│   │   └── mod.rs
│   └── error.rs             # Error types
├── tauri.conf.json          # Configuration
└── Cargo.toml
```

## Building

```bash
cargo tauri build
```

## Development

```bash
cargo tauri dev
```

This launches:
- Tauri window on port 8000
- React dev server on port 5173 (HMR)
- Hot reload on code changes

## IPC Handlers

All commands are async and return JSON-serialized results.

### Example: `import_hand_history`

```rust
#[tauri::command]
async fn import_hand_history(
    file_path: String,
    config: ImportConfig,
    window: tauri::Window,
) -> Result<ImportResult, String> {
    hh_ingest::import_with_progress(&file_path, config, |progress| {
        let _ = window.emit(\"import_progress\", progress);
    })
    .await
    .map_err(|e| e.to_string())
}
```

## Error Handling

Tauri errors are serialized to JSON and sent to frontend:

```json
{
  \"error\": {
    \"type\": \"ImportError\",
    \"message\": \"Failed to parse hand history\",
    \"context\": \"Line 42: Unknown action\"
  }
}
```

See [ARCHITECTURE.md](../../docs/design/ARCHITECTURE.md) for module contracts.
