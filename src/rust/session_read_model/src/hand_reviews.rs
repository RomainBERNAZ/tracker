use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::collections::BTreeSet;

const TAG_SEPARATOR: char = '\u{1f}';
const MAX_NOTE_CHARS: usize = 2_000;
const MAX_TAGS: usize = 8;
const MAX_TAG_CHARS: usize = 40;
const MAX_GOAL_CHARS: usize = 240;

#[derive(Debug, Clone, Serialize)]
pub struct HandReview {
    pub hand_id: String,
    pub note: String,
    pub tags: Vec<String>,
    pub favorite: bool,
    pub reviewed: bool,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct HandReviewEntry {
    pub hand_id: String,
    pub tournament_id: String,
    pub timestamp: String,
    pub level: i64,
    pub big_blind: i64,
    pub player_count: i64,
    pub hero_cev: i64,
    pub hero_net_ev: Option<i64>,
    pub hero_cards: Option<String>,
    pub note: String,
    pub tags: Vec<String>,
    pub favorite: bool,
    pub reviewed: bool,
    pub updated_at: String,
}

fn tags_from_db(value: &str) -> Vec<String> {
    value
        .split(TAG_SEPARATOR)
        .filter(|tag| !tag.is_empty())
        .map(str::to_string)
        .collect()
}

pub fn get_hand_review(
    conn: &Connection,
    hand_id: &str,
) -> Result<Option<HandReview>, rusqlite::Error> {
    let review = conn
        .query_row(
            "SELECT note, favorite, reviewed, updated_at FROM hand_reviews WHERE hand_id = ?1",
            params![hand_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)? != 0,
                    row.get::<_, i64>(2)? != 0,
                    row.get::<_, String>(3)?,
                ))
            },
        )
        .optional()?;

    review
        .map(|(note, favorite, reviewed, updated_at)| {
            let mut statement =
                conn.prepare("SELECT tag FROM hand_review_tags WHERE hand_id = ?1 ORDER BY tag")?;
            let tags = statement
                .query_map(params![hand_id], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(HandReview {
                hand_id: hand_id.to_string(),
                note,
                tags,
                favorite,
                reviewed,
                updated_at,
            })
        })
        .transpose()
}

pub fn list_hand_reviews(conn: &Connection) -> Result<Vec<HandReviewEntry>, rusqlite::Error> {
    let mut statement = conn.prepare(
        r#"SELECT r.hand_id, h.tournament_id, h.timestamp, h.level, h.big_blind,
                  h.player_count, hp.realized_cev, hp.net_ev, hc.card1 || ' ' || hc.card2,
                  r.note, r.favorite, r.reviewed, r.updated_at,
                  COALESCE(GROUP_CONCAT(rt.tag, char(31)), '')
           FROM hand_reviews r
           JOIN hands h ON h.id = r.hand_id
           JOIN hand_players hp ON hp.hand_id = h.id AND hp.hero = 1
           LEFT JOIN hole_cards hc ON hc.hand_id = h.id
           LEFT JOIN hand_review_tags rt ON rt.hand_id = r.hand_id
           GROUP BY r.hand_id
           ORDER BY r.reviewed ASC, r.favorite DESC, r.updated_at DESC, h.timestamp DESC"#,
    )?;
    let rows = statement.query_map([], |row| {
        let tags: String = row.get(13)?;
        Ok(HandReviewEntry {
            hand_id: row.get(0)?,
            tournament_id: row.get(1)?,
            timestamp: row.get(2)?,
            level: row.get(3)?,
            big_blind: row.get(4)?,
            player_count: row.get(5)?,
            hero_cev: row.get(6)?,
            hero_net_ev: row.get(7)?,
            hero_cards: row.get(8)?,
            note: row.get(9)?,
            favorite: row.get::<_, i64>(10)? != 0,
            reviewed: row.get::<_, i64>(11)? != 0,
            updated_at: row.get(12)?,
            tags: tags_from_db(&tags),
        })
    })?;
    rows.collect()
}

pub fn save_hand_review(
    conn: &Connection,
    hand_id: &str,
    note: &str,
    tags: &[String],
    favorite: bool,
    reviewed: bool,
) -> Result<Option<HandReview>, String> {
    let note = note.trim();
    if note.chars().count() > MAX_NOTE_CHARS {
        return Err(format!(
            "La note ne peut pas dépasser {MAX_NOTE_CHARS} caractères."
        ));
    }

    let mut unique_tags = BTreeSet::new();
    for tag in tags {
        let tag = tag.trim();
        if tag.is_empty()
            || tag.chars().count() > MAX_TAG_CHARS
            || tag.contains(TAG_SEPARATOR)
            || tag.chars().any(char::is_control)
        {
            return Err(format!(
                "Chaque tag doit contenir de 1 à {MAX_TAG_CHARS} caractères."
            ));
        }
        unique_tags.insert(tag.to_string());
    }
    if unique_tags.len() > MAX_TAGS {
        return Err(format!(
            "Une main ne peut pas avoir plus de {MAX_TAGS} tags."
        ));
    }

    let transaction = conn
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    let exists: bool = transaction
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM hands h JOIN hand_players hp ON hp.hand_id = h.id AND hp.hero = 1 WHERE h.id = ?1)",
            params![hand_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if !exists {
        return Err(format!("La main « {hand_id} » est introuvable."));
    }

    if note.is_empty() && unique_tags.is_empty() && !favorite && !reviewed {
        transaction
            .execute(
                "DELETE FROM hand_reviews WHERE hand_id = ?1",
                params![hand_id],
            )
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;
        return Ok(None);
    }

    transaction
        .execute(
            r#"INSERT INTO hand_reviews (hand_id, note, favorite, reviewed)
               VALUES (?1, ?2, ?3, ?4)
               ON CONFLICT(hand_id) DO UPDATE SET
                   note = excluded.note,
                   favorite = excluded.favorite,
                   reviewed = excluded.reviewed,
                   updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')"#,
            params![hand_id, note, favorite, reviewed],
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "DELETE FROM hand_review_tags WHERE hand_id = ?1",
            params![hand_id],
        )
        .map_err(|error| error.to_string())?;
    for tag in unique_tags {
        transaction
            .execute(
                "INSERT INTO hand_review_tags (hand_id, tag) VALUES (?1, ?2)",
                params![hand_id, tag],
            )
            .map_err(|error| error.to_string())?;
    }
    transaction.commit().map_err(|error| error.to_string())?;
    get_hand_review(conn, hand_id).map_err(|error| error.to_string())
}

pub fn get_coach_goal(conn: &Connection) -> Result<String, rusqlite::Error> {
    conn.query_row("SELECT goal FROM coach_goal WHERE id = 1", [], |row| {
        row.get(0)
    })
    .optional()
    .map(|goal| goal.unwrap_or_default())
}

pub fn save_coach_goal(conn: &Connection, goal: &str) -> Result<String, String> {
    let goal = goal.trim();
    if goal.chars().count() > MAX_GOAL_CHARS {
        return Err(format!(
            "L’objectif ne peut pas dépasser {MAX_GOAL_CHARS} caractères."
        ));
    }
    conn.execute(
        r#"INSERT INTO coach_goal (id, goal) VALUES (1, ?1)
           ON CONFLICT(id) DO UPDATE SET
               goal = excluded.goal,
               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')"#,
        params![goal],
    )
    .map_err(|error| error.to_string())?;
    Ok(goal.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn database() -> Connection {
        let conn = Connection::open_in_memory().expect("open database");
        conn.execute_batch(
            r#"
            PRAGMA foreign_keys = ON;
            CREATE TABLE hands (
                id TEXT PRIMARY KEY, tournament_id TEXT NOT NULL, timestamp TEXT NOT NULL,
                level INTEGER NOT NULL, big_blind INTEGER NOT NULL, player_count INTEGER NOT NULL
            );
            CREATE TABLE hand_players (
                hand_id TEXT NOT NULL, hero INTEGER NOT NULL, realized_cev INTEGER NOT NULL,
                net_ev INTEGER
            );
            CREATE TABLE hole_cards (hand_id TEXT NOT NULL, card1 TEXT NOT NULL, card2 TEXT NOT NULL);
            CREATE TABLE hand_reviews (
                hand_id TEXT PRIMARY KEY, note TEXT NOT NULL, favorite INTEGER NOT NULL,
                reviewed INTEGER NOT NULL, updated_at TEXT NOT NULL DEFAULT 'now'
            );
            CREATE TABLE hand_review_tags (
                hand_id TEXT NOT NULL, tag TEXT NOT NULL,
                PRIMARY KEY (hand_id, tag),
                FOREIGN KEY (hand_id) REFERENCES hand_reviews(hand_id) ON DELETE CASCADE
            );
            CREATE TABLE coach_goal (id INTEGER PRIMARY KEY, goal TEXT NOT NULL);
            INSERT INTO hands VALUES ('H1', 'T1', '2026-01-01T00:00:00Z', 1, 20, 3);
            INSERT INTO hand_players VALUES ('H1', 1, -40, -20);
            INSERT INTO hole_cards VALUES ('H1', 'As', 'Kd');
            "#,
        )
        .expect("create schema");
        conn
    }

    #[test]
    fn saving_review_tags_and_note_returns_a_joined_queue_row() {
        let conn = database();
        let saved = save_hand_review(
            &conn,
            "H1",
            "Revoir le sizing",
            &["Défense BB".into(), "Défense BB".into()],
            true,
            false,
        )
        .expect("save review")
        .expect("saved row");

        assert_eq!(saved.tags, vec!["Défense BB"]);
        assert!(saved.favorite);
        let fetched = get_hand_review(&conn, "H1")
            .expect("get review")
            .expect("review exists");
        assert_eq!(fetched.hand_id, saved.hand_id);
        assert_eq!(fetched.note, saved.note);
        assert_eq!(fetched.tags, saved.tags);
        assert_eq!(fetched.favorite, saved.favorite);
        assert_eq!(fetched.reviewed, saved.reviewed);
        assert_eq!(fetched.updated_at, saved.updated_at);

        let queue = list_hand_reviews(&conn).expect("list review queue");
        assert_eq!(queue.len(), 1);
        assert_eq!(queue[0].hero_cards.as_deref(), Some("As Kd"));
        assert_eq!(queue[0].hero_cev, -40);
    }

    #[test]
    fn clearing_the_last_review_field_removes_the_queue_entry() {
        let conn = database();
        save_hand_review(&conn, "H1", "Note", &[], false, false).expect("save review");
        assert!(save_hand_review(&conn, "H1", "", &[], false, false)
            .expect("clear review")
            .is_none());
        assert!(list_hand_reviews(&conn).expect("list queue").is_empty());
    }

    #[test]
    fn review_input_is_bounded_and_unknown_hands_are_rejected() {
        let conn = database();
        assert!(save_hand_review(&conn, "missing", "", &[], false, false).is_err());
        assert!(save_hand_review(
            &conn,
            "H1",
            &"x".repeat(MAX_NOTE_CHARS + 1),
            &[],
            false,
            false
        )
        .is_err());
        assert!(save_hand_review(&conn, "H1", "", &["".into()], false, false).is_err());
    }

    #[test]
    fn coach_goal_is_trimmed_and_persisted() {
        let conn = database();
        assert_eq!(get_coach_goal(&conn).expect("get empty goal"), "");
        assert_eq!(
            save_coach_goal(&conn, "  Defense BB  ").expect("save goal"),
            "Defense BB"
        );
        assert_eq!(get_coach_goal(&conn).expect("get saved goal"), "Defense BB");
    }
}
