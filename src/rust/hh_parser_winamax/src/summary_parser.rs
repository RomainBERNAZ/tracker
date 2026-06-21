use regex::Regex;
use chrono::NaiveDateTime;
use crate::error::ParseError;
use crate::types::TournamentSummary;

/// Parse a Winamax tournament summary file (`*_summary.txt`).
pub fn parse_tournament_summary(content: &str) -> Result<TournamentSummary, ParseError> {
    let mut tournament_name = String::new();
    let mut tournament_id = String::new();
    let mut player_name = String::new();
    let mut buy_in_euros = 0f64;
    let mut rake_euros = 0f64;
    let mut registered_players = 0u32;
    let mut prizepool_euros = 0f64;
    let mut started_at = chrono::DateTime::default();
    let mut duration_secs = 0u64;
    let mut finish_position = 0u32;

    let re_header = Regex::new(
        r#"^Winamax Poker - Tournament summary : (.+)\((\d+)\)$"#,
    )
    .unwrap();
    let re_buyin = Regex::new(r#"^Buy-In : ([\d.]+)€ \+ ([\d.]+)€$"#).unwrap();
    let re_players = Regex::new(r#"^Registered players : (\d+)$"#).unwrap();
    let re_prizepool = Regex::new(r#"^Prizepool : ([\d.]+)€$"#).unwrap();
    let re_started = Regex::new(r#"^Tournament started (\d{4}/\d{2}/\d{2} \d{2}:\d{2}:\d{2}) UTC$"#).unwrap();
    let re_duration = Regex::new(r#"^You played (\d+)min (\d+)s$"#).unwrap();
    let re_duration_s = Regex::new(r#"^You played (\d+)s$"#).unwrap();
    let re_finish = Regex::new(r#"^You finished in (\d+)(?:st|nd|rd|th) place$"#).unwrap();

    for raw in content.lines() {
        let line = raw.trim();

        if let Some(caps) = re_header.captures(line) {
            tournament_name = caps[1].trim().to_string();
            tournament_id = caps[2].to_string();
        } else if line.starts_with("Player : ") {
            player_name = line["Player : ".len()..].to_string();
        } else if let Some(caps) = re_buyin.captures(line) {
            buy_in_euros = caps[1].parse().unwrap_or(0.0);
            rake_euros = caps[2].parse().unwrap_or(0.0);
        } else if let Some(caps) = re_players.captures(line) {
            registered_players = caps[1].parse().unwrap_or(0);
        } else if let Some(caps) = re_prizepool.captures(line) {
            prizepool_euros = caps[1].parse().unwrap_or(0.0);
        } else if let Some(caps) = re_started.captures(line) {
            started_at = NaiveDateTime::parse_from_str(&caps[1], "%Y/%m/%d %H:%M:%S")
                .map(|ndt| ndt.and_utc())
                .unwrap_or_default();
        } else if let Some(caps) = re_duration.captures(line) {
            let mins: u64 = caps[1].parse().unwrap_or(0);
            let secs: u64 = caps[2].parse().unwrap_or(0);
            duration_secs = mins * 60 + secs;
        } else if let Some(caps) = re_duration_s.captures(line) {
            duration_secs = caps[1].parse().unwrap_or(0);
        } else if let Some(caps) = re_finish.captures(line) {
            finish_position = caps[1].parse().unwrap_or(0);
        }
    }

    if tournament_id.is_empty() {
        return Err(ParseError::MalformedTournamentSummary(
            "missing tournament header".into(),
        ));
    }

    // Compute multiplier: prizepool = multiplier × buy_in_total_per_player
    let total_per_player = buy_in_euros + rake_euros;
    let multiplier = if total_per_player > 0.0 {
        (prizepool_euros / total_per_player).round() as u32
    } else {
        0
    };

    Ok(TournamentSummary {
        tournament_name,
        tournament_id,
        player_name,
        buy_in_euros,
        rake_euros,
        registered_players,
        prizepool_euros,
        multiplier,
        started_at,
        duration_secs,
        finish_position,
    })
}
