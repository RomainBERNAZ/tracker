use thiserror::Error;

#[derive(Debug, Error)]
pub enum ParseError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Malformed hand header at line {line}: {detail}")]
    MalformedHeader { line: usize, detail: String },

    #[error("Malformed table line at line {line}: {detail}")]
    MalformedTable { line: usize, detail: String },

    #[error("No players found in hand {hand_id}")]
    NoPlayers { hand_id: String },

    #[error("Incomplete hand {hand_id}: missing summary section")]
    IncompleteSummary { hand_id: String },

    #[error("Invalid amount '{value}' at line {line}")]
    InvalidAmount { value: String, line: usize },

    #[error("Malformed summary line at line {line}: {detail}")]
    MalformedSummary { line: usize, detail: String },

    #[error("Timestamp parse error: {0}")]
    Timestamp(String),

    #[error("Malformed tournament summary: {0}")]
    MalformedTournamentSummary(String),
}
