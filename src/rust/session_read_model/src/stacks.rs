use super::{
    compute_preflop_stats, CoachFormatStats, PreflopActionSample, PreflopHandSample,
    HERO_SHOWDOWN_SQL,
};
use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::{btree_map::Entry, BTreeMap};

#[derive(Debug, Default, Serialize)]
pub struct StackChipTotals {
    pub net: f64,
    pub ev: f64,
    pub sd: f64,
    pub sd_ev: f64,
    pub wsd: f64,
    pub wsd_ev: f64,
}

impl StackChipTotals {
    fn add(&mut self, net: i64, ev: i64, showdown: bool, divisor: f64) {
        self.net += net as f64 / divisor;
        self.ev += ev as f64 / divisor;
        if showdown {
            self.sd += net as f64 / divisor;
            self.sd_ev += ev as f64 / divisor;
        } else {
            self.wsd += net as f64 / divisor;
            self.wsd_ev += ev as f64 / divisor;
        }
    }
}

#[derive(Debug, Serialize)]
pub struct StackStatsGroup {
    pub bucket: usize,
    pub player_count: i64,
    pub hands: i64,
    pub preflop: CoachFormatStats,
    pub chips: StackChipTotals,
    pub bb: StackChipTotals,
    pub missing_ev_hands: i64,
    pub missing_preflop_hands: i64,
}

#[derive(Debug, Default, Serialize)]
pub struct StackStatsSnapshot {
    pub groups: Vec<StackStatsGroup>,
    pub excluded_hands: i64,
}

struct StackHand {
    preflop: PreflopHandSample,
    starting_stack: i64,
    big_blind: i64,
    net: i64,
    ev: Option<i64>,
    showdown: bool,
}

#[derive(Default)]
struct StackAccumulator {
    hands: i64,
    samples: Vec<PreflopHandSample>,
    chips: StackChipTotals,
    bb: StackChipTotals,
    missing_ev_hands: i64,
    missing_preflop_hands: i64,
}

fn stack_bucket(starting_stack: i64, big_blind: i64) -> Option<usize> {
    if starting_stack <= 0 || big_blind <= 0 {
        return None;
    }
    let bb = starting_stack as f64 / big_blind as f64;
    Some(if bb <= 8.0 {
        0
    } else if bb <= 12.0 {
        1
    } else if bb <= 20.0 {
        2
    } else {
        3
    })
}

/// One query for the exact tournament cohort, including all its hands across midnight.
pub fn get_stack_stats(
    conn: &Connection,
    tournament_ids: &[String],
) -> Result<StackStatsSnapshot, rusqlite::Error> {
    let ids = serde_json::to_string(tournament_ids)
        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
    let mut stmt = conn.prepare(&format!(
        r#"SELECT h.id, h.player_count, h.level, h.big_blind,
                  hp.player_name, hp.starting_stack, hp.realized_cev, hp.net_ev,
                  {HERO_SHOWDOWN_SQL}, a.player_name, a.action_type
           FROM hands h
           JOIN hand_players hp ON hp.hand_id = h.id AND hp.hero = 1
           LEFT JOIN hand_actions a ON a.hand_id = h.id AND a.street_order = 0
           WHERE h.tournament_id IN (SELECT value FROM json_each(?1))
           ORDER BY h.id, a.action_index, a.id"#,
    ))?;
    let mut rows = stmt.query(params![ids])?;
    let mut hands: BTreeMap<String, StackHand> = BTreeMap::new();
    while let Some(row) = rows.next()? {
        let id: String = row.get(0)?;
        let hand = match hands.entry(id) {
            Entry::Occupied(entry) => entry.into_mut(),
            Entry::Vacant(entry) => entry.insert(StackHand {
                preflop: PreflopHandSample {
                    player_count: row.get(1)?,
                    level: row.get(2)?,
                    hero_name: row.get(4)?,
                    actions: Vec::new(),
                },
                starting_stack: row.get(5)?,
                big_blind: row.get(3)?,
                net: row.get(6)?,
                ev: row.get(7)?,
                showdown: row.get::<_, i64>(8)? != 0,
            }),
        };
        let player_name: Option<String> = row.get(9)?;
        let action_type: Option<String> = row.get(10)?;
        if let (Some(player_name), Some(action_type)) = (player_name, action_type) {
            hand.preflop.actions.push(PreflopActionSample {
                player_name,
                action_type,
            });
        }
    }

    let mut snapshot = StackStatsSnapshot::default();
    let mut groups: BTreeMap<(usize, i64), StackAccumulator> = BTreeMap::new();
    for hand in hands.into_values() {
        let Some(bucket) = stack_bucket(hand.starting_stack, hand.big_blind) else {
            snapshot.excluded_hands += 1;
            continue;
        };
        if !matches!(hand.preflop.player_count, 2 | 3) {
            snapshot.excluded_hands += 1;
            continue;
        }
        let group = groups
            .entry((bucket, hand.preflop.player_count))
            .or_default();
        group.hands += 1;
        let ev = hand.ev.unwrap_or(hand.net);
        group.chips.add(hand.net, ev, hand.showdown, 1.0);
        group
            .bb
            .add(hand.net, ev, hand.showdown, hand.big_blind as f64);
        group.missing_ev_hands += i64::from(hand.ev.is_none());
        if hand.preflop.actions.is_empty() {
            group.missing_preflop_hands += 1;
        } else {
            group.samples.push(hand.preflop);
        }
    }
    for ((bucket, player_count), group) in groups {
        snapshot.groups.push(StackStatsGroup {
            bucket,
            player_count,
            hands: group.hands,
            preflop: compute_preflop_stats(&group.samples, player_count),
            chips: group.chips,
            bb: group.bb,
            missing_ev_hands: group.missing_ev_hands,
            missing_preflop_hands: group.missing_preflop_hands,
        });
    }
    Ok(snapshot)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stack_boundaries_use_the_hero_stack_before_forced_bets() {
        for (stack, expected) in [
            (1, 0),
            (160, 0),
            (161, 1),
            (240, 1),
            (241, 2),
            (400, 2),
            (401, 3),
        ] {
            assert_eq!(stack_bucket(stack, 20), Some(expected));
        }
        assert_eq!(stack_bucket(0, 20), None);
        assert_eq!(stack_bucket(-1, 20), None);
        assert_eq!(stack_bucket(500, 0), None);
    }
}
