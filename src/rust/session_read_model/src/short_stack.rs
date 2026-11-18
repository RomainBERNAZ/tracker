use super::json;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Serialize)]
pub struct Tournament {
    id: String,
    started_at: String,
    buy_in: f64,
    net_eur: f64,
    room: String,
}

#[derive(Debug, Serialize)]
pub struct Encounter {
    hand_id: String,
    tournament_id: String,
    timestamp: String,
    villain: String,
    position: &'static str,
    player_count: usize,
    effective_bb: f64,
    villain_bb: f64,
    hero_bb: f64,
    rank: Option<usize>,
    villain_actions: Vec<String>,
    hero_actions: Vec<String>,
    villain_cards: Option<[String; 2]>,
    hero_cards: Option<[String; 2]>,
    result: &'static str,
    hero_ev_bb: Option<f64>,
}

#[derive(Debug, Default, Serialize)]
pub struct Snapshot {
    tournaments: Vec<Tournament>,
    encounters: Vec<Encounter>,
}

#[derive(Deserialize)]
struct Player {
    name: String,
    seat: i64,
    start: i64,
    end: i64,
    collected: i64,
    hero: i64,
    ev: Option<i64>,
    cards: Option<[String; 2]>,
}

#[derive(Deserialize)]
struct Action(String, String);

struct Episode {
    short: bool,
    rank: Option<usize>,
    last_hand: usize,
    ending_stack: i64,
}

impl Episode {
    fn observe(previous: Option<&Self>, hand: usize, start: i64, end: i64, short: bool) -> Self {
        let rank = if short {
            previous
                .filter(|p| p.last_hand + 1 == hand && p.ending_stack == start)
                .and_then(|p| if p.short { p.rank } else { Some(0) })
        } else {
            None
        };
        Self {
            short,
            rank,
            last_hand: hand,
            ending_stack: end,
        }
    }

    fn encounter(&mut self) -> Option<usize> {
        self.rank = self.rank.map(|rank| rank + 1);
        self.rank
    }
}

fn positions(seats: &[Player], button: i64) -> Vec<&'static str> {
    let Some(button_index) = seats.iter().position(|p| p.seat == button) else {
        return vec!["?"; seats.len()];
    };
    let names = if seats.len() == 2 {
        &["BTN", "BB"][..]
    } else {
        &["BTN", "SB", "BB"][..]
    };
    (0..seats.len())
        .map(|index| names[(index + seats.len() - button_index) % seats.len()])
        .collect()
}

fn confrontation(
    actions: &[Action],
    hero: &str,
    villain: &str,
    forced_all_in: [bool; 2],
) -> Option<(Vec<String>, Vec<String>)> {
    let mut last_raiser = None;
    let mut entered = [false; 2];
    let mut timeline = forced_all_in.map(|forced| {
        if forced {
            vec!["forced_allin".into()]
        } else {
            Vec::new()
        }
    });
    let mut matched = false;
    let mut raised = false;
    for Action(player, kind) in actions {
        let player = player.as_str();
        let kind = kind.as_str();
        let side = if player == hero {
            Some(0)
        } else if player == villain {
            Some(1)
        } else {
            None
        };
        let aggression = matches!(kind, "raise" | "bet" | "allin_raise" | "allin_bet");
        let invests = aggression || matches!(kind, "call" | "allin_call");
        if let Some(side) = side {
            let other = if side == 0 { villain } else { hero };
            match kind {
                "collect" => continue,
                "call" if !raised => timeline[side].push("limp".into()),
                "allin_raise" | "allin_bet" => timeline[side].push("shove".into()),
                _ => timeline[side].push(kind.into()),
            }
            if kind == "fold" {
                matched |= last_raiser == Some(other);
                break;
            }
            if kind == "check" && !raised {
                matched |= entered[1 - side];
            }
            if invests {
                // Both players put chips into a shared pot, or one directly answered the other.
                matched |=
                    forced_all_in[1 - side] || entered[1 - side] || last_raiser == Some(other);
                entered[side] = true;
            }
        }
        if aggression {
            last_raiser = Some(player);
            raised = true;
        }
    }
    let [hero, villain] = timeline;
    matched.then_some((hero, villain))
}

pub fn get_snapshot(conn: &Connection) -> rusqlite::Result<Snapshot> {
    let mut tournaments = conn.prepare(
        "SELECT t.id, t.started_at, ROUND(t.buy_in_euros + t.rake_euros, 6), t.net_eur,
                (SELECT h.game_name FROM hands h WHERE h.tournament_id = t.id LIMIT 1)
         FROM tournaments t ORDER BY t.started_at, t.id",
    )?;
    let tournaments = tournaments
        .query_map([], |row| {
            let name = row
                .get::<_, Option<String>>(4)?
                .unwrap_or_default()
                .to_lowercase();
            let room = if name.contains("expresso") {
                "Winamax"
            } else if name.contains("spin") || name.contains("rush") {
                "Betclic"
            } else {
                "Inconnue"
            };
            Ok(Tournament {
                id: row.get(0)?,
                started_at: row.get(1)?,
                buy_in: row.get(2)?,
                net_eur: row.get(3)?,
                room: room.into(),
            })
        })?
        .collect::<rusqlite::Result<_>>()?;

    let mut stmt = conn.prepare(
        "SELECT h.id, h.tournament_id, h.timestamp, h.big_blind, h.button_seat, h.player_count,
           (SELECT json_group_array(json_object(
                'name', p.player_name, 'seat', p.seat_number, 'start', p.starting_stack,
                'end', p.ending_stack, 'collected', p.collected, 'hero', p.hero,
                'ev', CASE WHEN p.allin_equity IS NOT NULL THEN p.net_ev END,
                'cards', CASE WHEN hc.card1 IS NOT NULL THEN json_array(hc.card1, hc.card2)
                              WHEN sc.card1 IS NOT NULL THEN json_array(sc.card1, sc.card2) END))
            FROM hand_players p
            LEFT JOIN hole_cards hc ON hc.hand_id = p.hand_id AND hc.player_name = p.player_name
            LEFT JOIN showdown_hole_cards sc ON sc.hand_id = p.hand_id AND sc.player_name = p.player_name
            WHERE p.hand_id = h.id),
           (SELECT json_group_array(json_array(a.player_name, a.action_type)) FROM
                (SELECT player_name, action_type FROM hand_actions
                 WHERE hand_id = h.id AND street_order = 0 ORDER BY action_index, id) a),
           h.small_blind
         FROM hands h ORDER BY h.tournament_id, h.timestamp, h.rowid",
    )?;
    let mut rows = stmt.query([])?;
    let mut encounters = Vec::new();
    let mut episodes = HashMap::<String, Episode>::new();
    let mut previous_tournament = String::new();
    let mut hand = 0;
    while let Some(row) = rows.next()? {
        let tournament_id: String = row.get(1)?;
        if previous_tournament != tournament_id {
            episodes.clear();
            previous_tournament.clone_from(&tournament_id);
            hand = 0;
        }
        hand += 1;
        let bb: i64 = row.get(3)?;
        let count: usize = row.get(5)?;
        if bb <= 0 || !matches!(count, 2 | 3) {
            continue;
        }
        let mut players: Vec<Player> = json(row, 6)?;
        if players.len() != count {
            continue;
        }
        players.sort_unstable_by_key(|p| p.seat);
        let Some((hero_index, hero)) = players
            .iter()
            .enumerate()
            .find(|(_, p)| p.hero == 1 && p.start > 0)
        else {
            continue;
        };
        let positions = positions(&players, row.get(4)?);
        let sb: i64 = row.get(8)?;
        let forced_all_in = |p: &Player, position| {
            p.start
                <= match position {
                    "BB" => bb,
                    "SB" => sb,
                    "BTN" if count == 2 => sb,
                    _ => 0,
                }
        };
        let mut actions = None;
        for (index, villain) in players
            .iter()
            .enumerate()
            .filter(|(_, p)| p.hero == 0 && p.start > 0)
        {
            let short = villain.start <= 5 * bb;
            let episode = Episode::observe(
                episodes.get(&villain.name),
                hand,
                villain.start,
                villain.end,
                short,
            );
            let episode = episodes
                .entry(villain.name.clone())
                .insert_entry(episode)
                .into_mut();
            if !short && hero.start > 5 * bb {
                continue;
            }
            if actions.is_none() {
                actions = Some(json::<Vec<Action>>(row, 7)?);
            }
            let Some((hero_actions, villain_actions)) = confrontation(
                actions.as_deref().unwrap_or_default(),
                &hero.name,
                &villain.name,
                [
                    forced_all_in(hero, positions[hero_index]),
                    forced_all_in(villain, positions[index]),
                ],
            ) else {
                continue;
            };
            let result = if hero.collected == 0 {
                "lost"
            } else if count == 2 && villain.collected > 0 {
                "split"
            } else if players.iter().any(|p| p.hero == 0 && p.collected > 0) {
                "multiple"
            } else {
                "won"
            };
            let bb = bb as f64;
            encounters.push(Encounter {
                hand_id: row.get(0)?,
                tournament_id: tournament_id.clone(),
                timestamp: row.get(2)?,
                villain: villain.name.clone(),
                position: positions[index],
                player_count: count,
                effective_bb: hero.start.min(villain.start) as f64 / bb,
                villain_bb: villain.start as f64 / bb,
                hero_bb: hero.start as f64 / bb,
                rank: episode.encounter(),
                hero_actions,
                villain_actions,
                villain_cards: villain.cards.clone(),
                hero_cards: hero.cards.clone(),
                result,
                hero_ev_bb: hero.ev.map(|ev| ev as f64 / bb),
            });
        }
    }
    Ok(Snapshot {
        tournaments,
        encounters,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_complete_episodes_before_filtering_and_keeps_unrevealed_encounters() {
        let conn = hh_ingest::db::open_memory().unwrap();
        conn.execute_batch(
                    "INSERT INTO tournaments (id, player_name, buy_in_euros, rake_euros, prizepool_euros, multiplier,
                      registered_players, finish_position, started_at, duration_secs, net_eur)
                     VALUES ('T', 'Hero', 1.85, 0.15, 4, 2, 3, 1, '2026-01-01T10:00:00Z', 100, 2);
                     WITH RECURSIVE seq(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM seq WHERE i<7)
                     INSERT INTO hands (id, tournament_id, table_name, game_name, buy_in_euros, rake_euros, level,
                       small_blind, big_blind, button_seat, seat_count, timestamp, player_count)
                     SELECT 'H'||i, 'T', 'table', 'Expresso', 1.85, 0.15, 1, 10, 20, 1, 3,
                            '2026-01-01T10:00:0'||i||'Z', 2 FROM seq;
                     INSERT INTO hand_players (hand_id, seat_number, player_name, starting_stack, ending_stack,
                       contributions, collected, realized_cev, hero)
                     SELECT id, 1, 'Hero', CASE WHEN id='H1' THEN 80 ELSE 400 END, 400, 20, 40, 20, 1 FROM hands;
                     INSERT INTO hand_players VALUES
                       (101,'H1',3,'V',80,85,20,0,-20,NULL,NULL,0),
                       (102,'H2',3,'V',85,120,0,20,20,NULL,NULL,0),
                       (103,'H3',3,'V',120,100,20,0,-20,NULL,NULL,0),
                       (104,'H4',3,'V',100,95,0,20,20,NULL,NULL,0),
                       (105,'H5',3,'V',95,100,20,0,-20,NULL,NULL,0),
                       (106,'H6',3,'V',100,100,20,0,-20,NULL,NULL,0),
                       (107,'H7',3,'V',90,0,20,0,-20,NULL,NULL,0);
                     INSERT INTO hand_actions (hand_id, street_order, street, action_index, player_name, action_type)
                     SELECT id, 0, 'preflop', 0, 'Hero', CASE WHEN id='H4' THEN 'fold' ELSE 'allin_raise' END FROM hands;
                     INSERT INTO hand_actions (hand_id, street_order, street, action_index, player_name, action_type)
                     SELECT id, 0, 'preflop', 1, 'V', CASE WHEN id='H6' THEN 'allin_call' ELSE 'fold' END FROM hands;
                     INSERT INTO showdown_hole_cards (hand_id, player_name, card1, card2) VALUES ('H6','V','As','Kd');",
                ).unwrap();
        let snapshot = get_snapshot(&conn).unwrap();
        assert_eq!(snapshot.tournaments[0].room, "Winamax");
        assert_eq!(snapshot.tournaments[0].buy_in, 2.0);
        let rows = &snapshot.encounters;
        assert_eq!(
            rows.iter()
                .map(|r| (r.hand_id.as_str(), r.rank))
                .collect::<Vec<_>>(),
            vec![
                ("H1", None),
                ("H2", None),
                ("H5", Some(1)),
                ("H6", Some(2)),
                ("H7", None)
            ]
        );
        assert_eq!(rows[2].position, "BB");
        assert_eq!(rows[3].effective_bb, 5.0);
        assert!(rows[2].villain_cards.is_none());
        assert_eq!(
            rows[3].villain_cards.as_ref().unwrap(),
            &["As".to_owned(), "Kd".to_owned()]
        );
    }

    #[test]
    fn separates_pair_interaction_from_an_unrelated_fold_and_includes_forced_blind_all_ins() {
        let actions = |pairs: &[(&str, &str)]| {
            pairs
                .iter()
                .map(|(p, a)| Action((*p).into(), (*a).into()))
                .collect::<Vec<_>>()
        };
        assert!(confrontation(
            &actions(&[("Third", "raise"), ("Hero", "fold"), ("V", "call")]),
            "Hero",
            "V",
            [false; 2]
        )
        .is_none());
        assert_eq!(
            confrontation(
                &actions(&[("Hero", "call"), ("V", "check")]),
                "Hero",
                "V",
                [false; 2]
            ),
            Some((vec!["limp".into()], vec!["check".into()]))
        );
        assert_eq!(
            confrontation(&actions(&[("Hero", "call")]), "Hero", "V", [false, true]),
            Some((vec!["limp".into()], vec!["forced_allin".into()]))
        );
    }
}
