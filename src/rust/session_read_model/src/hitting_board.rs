use super::json;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "snake_case")]
enum Pot {
    Open,
    Iso,
    Limped,
    OpponentRaise,
    Reraised,
}

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
enum Position {
    BTN,
    SB,
    BB,
    Middle,
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Ord, PartialOrd, Serialize)]
#[serde(rename_all = "snake_case")]
enum Category {
    TwoPairPlus,
    TopPair,
    MiddlePair,
    BottomPair,
    Overpair,
    Underpair,
    FlushDraw,
    Oesd,
    Gutshot,
    ComboDraw,
    TwoOvercards,
    OneOvercard,
    Air,
}

#[derive(Default, Debug)]
struct Draws {
    flush: bool,
    oesd: bool,
    gutshot: bool,
    backdoor_flush: bool,
    backdoor_straight: bool,
}

impl Draws {
    fn direct(&self) -> bool {
        self.flush || self.oesd || self.gutshot
    }

    fn combo(&self) -> bool {
        self.flush && (self.oesd || self.gutshot)
    }
}

#[derive(Default, Serialize)]
struct Counts {
    flops: u32,
    categories: BTreeMap<Category, u32>,
    pair_plus: u32,
    top_pair_plus: u32,
    direct_draw: u32,
    two_overs_or_draw: u32,
    no_pair_or_direct: u32,
    connected: u32,
    pair_and_direct: u32,
    flush_draw: u32,
    oesd: u32,
    gutshot: u32,
    combo_draw: u32,
    backdoor_flush: u32,
    backdoor_straight: u32,
}

impl Counts {
    fn observe(&mut self, made: Option<Category>, overs: usize, draws: &Draws) {
        use Category::*;
        let category = made.unwrap_or_else(|| {
            if draws.combo() {
                ComboDraw
            } else if draws.flush {
                FlushDraw
            } else if draws.oesd {
                Oesd
            } else if draws.gutshot {
                Gutshot
            } else if overs == 2 {
                TwoOvercards
            } else if overs == 1 {
                OneOvercard
            } else {
                Air
            }
        });
        let direct = draws.direct();
        let connected = made.is_some() || direct;
        self.flops += 1;
        *self.categories.entry(category).or_default() += 1;
        self.pair_plus += u32::from(made.is_some());
        self.top_pair_plus += u32::from(matches!(category, TwoPairPlus | TopPair | Overpair));
        self.direct_draw += u32::from(direct);
        self.two_overs_or_draw += u32::from(
            (made.is_none() && overs == 2)
                || direct
                || draws.backdoor_flush
                || draws.backdoor_straight,
        );
        self.no_pair_or_direct += u32::from(!connected);
        self.connected += u32::from(connected);
        self.pair_and_direct += u32::from(made.is_some() && direct);
        self.flush_draw += u32::from(draws.flush);
        self.oesd += u32::from(draws.oesd);
        self.gutshot += u32::from(draws.gutshot);
        self.combo_draw += u32::from(draws.combo());
        self.backdoor_flush += u32::from(draws.backdoor_flush);
        self.backdoor_straight += u32::from(draws.backdoor_straight);
    }
}

#[derive(Default, Serialize)]
struct Coverage {
    context_unknown: u32,
    flop_unknown: u32,
    hero_cards_unknown: u32,
    position_unknown: u32,
}

#[derive(Serialize)]
struct Group {
    pot: Pot,
    players: usize,
    position: Position,
    counts: Counts,
}

#[derive(Serialize)]
pub struct TournamentStats {
    tournament_id: String,
    coverage: Coverage,
    groups: Vec<Group>,
}

#[derive(Deserialize)]
struct Player {
    name: String,
    seat: i64,
    stack: i64,
    hero: bool,
}

#[derive(Deserialize)]
struct Action(String, String);

fn position(players: &[Player], button: i64, index: usize) -> Position {
    let Some(btn) = players.iter().position(|p| p.seat == button) else {
        return Position::Unknown;
    };
    match (players.len(), (index + players.len() - btn) % players.len()) {
        (_, 0) => Position::BTN,
        (2, 1) | (_, 2) => Position::BB,
        (_, 1) => Position::SB,
        _ => Position::Middle,
    }
}

fn parse_card(raw: &str) -> Option<(usize, usize)> {
    let [rank, suit] = *raw.as_bytes() else {
        return None;
    };
    let rank = b"23456789TJQKA"
        .iter()
        .position(|&r| r == rank.to_ascii_uppercase())?;
    let suit = b"cdhs"
        .iter()
        .position(|&s| s == suit.to_ascii_lowercase())?;
    Some((rank, suit))
}

fn classify(cards: [(usize, usize); 5]) -> (Option<Category>, usize, Draws) {
    use Category::*;
    let mut ranks = [0; 13];
    let mut suits = [0; 4];
    let mut board_ranks = [0; 13];
    let mut mask = 0u16;
    let mut hole_mask = 0u16;
    let mut hole_suit = [false; 4];
    for (i, (rank, suit)) in cards.into_iter().enumerate() {
        ranks[rank] += 1;
        suits[suit] += 1;
        mask |= 1 << rank;
        if i < 2 {
            hole_mask |= 1 << rank;
            hole_suit[suit] = true;
        } else {
            board_ranks[rank] += 1;
        }
    }
    let wheel = 0b1111 | (1 << 12);
    let board_mask = (1 << cards[2].0) | (1 << cards[3].0) | (1 << cards[4].0);
    let runs = (0..=8).map(|i| 0b11111 << i).chain([wheel]);
    let straight = runs.clone().any(|run| (run & mask) == run);
    let flush = suits.contains(&5);
    let direct_straight = !straight && runs.clone().any(|run| (run & mask).count_ones() == 4);
    // Consecutive 2345 can hit A or 6; TJQK can hit 9 or A. Double
    // gutshots have two outs by rank but no four-rank open-ended run.
    let oesd = direct_straight && (0..=8).any(|i| mask & (0b1111 << i) == (0b1111 << i));
    let draws = Draws {
        flush: !flush && suits.contains(&4),
        oesd,
        gutshot: direct_straight && !oesd,
        backdoor_flush: !flush
            && !suits.contains(&4)
            && (0..4).any(|suit| suits[suit] == 3 && hole_suit[suit]),
        backdoor_straight: !straight
            && !direct_straight
            && runs.clone().any(|run| {
                let present = run & mask;
                present.count_ones() == 3 && present & hole_mask & !board_mask != 0
            }),
    };
    let board_high = board_ranks.iter().rposition(|&n| n > 0).unwrap();
    let board_low = board_ranks.iter().position(|&n| n > 0).unwrap();
    let [a, b, ..] = cards.map(|(rank, _)| rank);
    let overs = [a, b].iter().filter(|&&rank| rank > board_high).count();
    let pairs = ranks.iter().filter(|&&n| n == 2).count();
    let made = if straight
        || flush
        || ranks.contains(&4)
        || (ranks.contains(&3) && pairs > 0)
        || (0..13).any(|i| ranks[i] == 3 && board_ranks[i] < 3)
        || pairs == 2
    {
        Some(TwoPairPlus)
    } else if a == b {
        if a > board_high {
            Some(Overpair)
        } else {
            Some(Underpair)
        }
    } else if board_ranks[a] > 0 || board_ranks[b] > 0 {
        let matched = if board_ranks[a] > 0 { a } else { b };
        Some(if matched == board_high {
            TopPair
        } else if matched == board_low {
            BottomPair
        } else {
            MiddlePair
        })
    } else {
        None
    };
    (made, overs, draws)
}

#[derive(PartialEq, Eq, Debug)]
enum Outcome {
    Outside,
    Unknown,
    Eligible { pot: Pot, count: usize },
}

fn is_raise(kind: &str) -> bool {
    matches!(kind, "raise" | "allin_raise" | "bet" | "allin_bet")
}

fn context(
    players: &[Player],
    actions: &[Action],
    later: &HashSet<String>,
    button: i64,
    blinds: [i64; 2],
) -> Outcome {
    let raises: Vec<_> = actions
        .iter()
        .enumerate()
        .filter(|(_, Action(_, kind))| is_raise(kind))
        .collect();
    let Some(hero) = players.iter().find(|p| p.hero) else {
        return Outcome::Unknown;
    };
    let folded: HashSet<_> = actions
        .iter()
        .filter_map(|Action(name, kind)| (kind == "fold").then_some(name.as_str()))
        .collect();
    if folded.contains(hero.name.as_str()) {
        return Outcome::Outside;
    }
    let seats: HashSet<_> = players.iter().map(|p| p.name.as_str()).collect();
    if seats.len() != players.len()
        || players.iter().filter(|p| p.hero).count() != 1
        || actions.iter().any(|Action(name, kind)| {
            !seats.contains(name.as_str())
                || !matches!(
                    kind.as_str(),
                    "fold"
                        | "call"
                        | "allin_call"
                        | "check"
                        | "raise"
                        | "allin_raise"
                        | "bet"
                        | "allin_bet"
                        | "collect"
                )
        })
        || !later
            .iter()
            .all(|name| seats.contains(name.as_str()) && !folded.contains(name.as_str()))
    {
        return Outcome::Unknown;
    }

    let count = players.len() - folded.len();
    if !matches!(count, 2 | 3) {
        return Outcome::Outside;
    }
    let pot = match raises.as_slice() {
        [] => Pot::Limped,
        [(_, Action(raiser, _))] if *raiser != hero.name => Pot::OpponentRaise,
        [(index, _)]
            if actions[..*index].iter().any(|Action(name, kind)| {
                *name != hero.name && matches!(kind.as_str(), "call" | "allin_call")
            }) =>
        {
            Pot::Iso
        }
        [_] => Pot::Open,
        _ => Pot::Reraised,
    };
    let last_raise = raises.last();
    let blind = |index| match position(players, button, index) {
        Position::BTN if players.len() == 2 => blinds[0],
        Position::SB => blinds[0],
        Position::BB => blinds[1],
        _ => 0,
    };
    let short_all_in = |index: usize, player: &Player| {
        player.stack > 0
            && (player.stack <= blind(index)
                || actions
                    .iter()
                    .any(|Action(name, kind)| *name == player.name && kind == "allin_call"))
    };
    // Betclic can deal the flop without emitting a check when the only live
    // opponent is all-in for no more than an already posted blind.
    let blind_covers_all_in = |index: usize, player: &Player| {
        pot == Pot::Limped
            && count == 2
            && players.iter().enumerate().any(|(other_index, other)| {
                other_index != index
                    && !folded.contains(other.name.as_str())
                    && short_all_in(other_index, other)
                    && other.stack <= blind(index).min(player.stack)
            })
    };
    if actions.is_empty()
        && !players
            .iter()
            .enumerate()
            .any(|(index, player)| blind_covers_all_in(index, player))
    {
        return Outcome::Unknown;
    }
    for (index, player) in players
        .iter()
        .enumerate()
        .filter(|(_, p)| !folded.contains(p.name.as_str()))
    {
        let acted =
            |action: &Action, expected: &str| action.0 == player.name && action.1 == expected;
        let matched = match last_raise {
            Some((index, Action(raiser, _))) => {
                *raiser == player.name
                    || actions[index + 1..]
                        .iter()
                        .any(|action| acted(action, "call"))
                    || actions[..*index].iter().any(|Action(name, kind)| {
                        *name == player.name && matches!(kind.as_str(), "allin_raise" | "allin_bet")
                    })
            }
            None => actions
                .iter()
                .any(|action| acted(action, "call") || acted(action, "check")),
        };
        if !(matched
            || later.contains(&player.name)
            || short_all_in(index, player)
            || blind_covers_all_in(index, player))
        {
            return Outcome::Unknown;
        }
    }
    Outcome::Eligible { pot, count }
}

type Groups = BTreeMap<(Pot, usize, Position), Counts>;

pub fn get_stats(conn: &Connection) -> rusqlite::Result<Vec<TournamentStats>> {
    let mut stmt = conn.prepare(
        "SELECT h.tournament_id, h.player_count, h.button_seat, h.small_blind, h.big_blind,
                h.board_cards, hc.card1, hc.card2, hc.player_name,
           (SELECT json_group_array(json_object(
                'name', p.player_name, 'seat', p.seat_number, 'stack', p.starting_stack,
                'hero', json(CASE WHEN p.hero = 1 THEN 'true' ELSE 'false' END)))
            FROM hand_players p WHERE p.hand_id = h.id),
           (SELECT json_group_array(json_array(a.player_name, a.action_type)) FROM
                (SELECT player_name, action_type FROM hand_actions
                 WHERE hand_id = h.id AND street_order = 0 ORDER BY action_index, id) a),
           (SELECT json_group_array(DISTINCT a.player_name) FROM hand_actions a
            WHERE a.hand_id = h.id AND a.street_order > 0)
         FROM hands h LEFT JOIN hole_cards hc ON hc.hand_id = h.id",
    )?;
    let mut rows = stmt.query([])?;
    let mut tournaments = HashMap::<String, (Coverage, Groups)>::new();
    while let Some(row) = rows.next()? {
        let board_raw: Option<String> = row.get(5)?;
        let board = board_raw
            .as_deref()
            .and_then(|raw| serde_json::from_str::<Vec<String>>(raw).ok());
        let has_flop = board.as_ref().is_some_and(|b| b.len() >= 3);
        let later: HashSet<String> = json(row, 11)?;
        let actions: Vec<Action> = json(row, 10)?;
        if !has_flop && later.is_empty() && !actions.iter().any(|Action(_, kind)| is_raise(kind)) {
            continue;
        }
        let mut players: Vec<Player> = json(row, 9)?;
        players.sort_unstable_by_key(|p| p.seat);
        let dealt: usize = row.get(1)?;
        let button = row.get(2)?;
        let (coverage, groups) = tournaments.entry(row.get(0)?).or_default();
        if players.len() != dealt {
            coverage.context_unknown += 1;
            continue;
        }
        let (pot, count) = match context(
            &players,
            &actions,
            &later,
            button,
            [row.get(3)?, row.get(4)?],
        ) {
            Outcome::Outside => continue,
            Outcome::Unknown => {
                coverage.context_unknown += 1;
                continue;
            }
            Outcome::Eligible { pot, count } => (pot, count),
        };
        let flop = board.as_ref().and_then(|b| {
            let [a, b, c, ..] = b.as_slice() else {
                return None;
            };
            let flop = [parse_card(a)?, parse_card(b)?, parse_card(c)?];
            (flop[0] != flop[1] && flop[0] != flop[2] && flop[1] != flop[2]).then_some(flop)
        });
        let Some([f1, f2, f3]) = flop else {
            coverage.flop_unknown += 1;
            continue;
        };
        let Some(hero_index) = players.iter().position(|p| p.hero) else {
            coverage.context_unknown += 1;
            continue;
        };
        let a: Option<String> = row.get(6)?;
        let b: Option<String> = row.get(7)?;
        let owner: Option<String> = row.get(8)?;
        let hole = a
            .as_deref()
            .and_then(parse_card)
            .zip(b.as_deref().and_then(parse_card));
        let Some((a, b)) = hole.filter(|&(a, b)| {
            owner.as_deref() == Some(&players[hero_index].name)
                && a != b
                && ![f1, f2, f3].contains(&a)
                && ![f1, f2, f3].contains(&b)
        }) else {
            coverage.hero_cards_unknown += 1;
            continue;
        };
        let position = position(&players, button, hero_index);
        coverage.position_unknown += u32::from(position == Position::Unknown);
        let (made, overs, draws) = classify([a, b, f1, f2, f3]);
        groups
            .entry((pot, count, position))
            .or_default()
            .observe(made, overs, &draws);
    }
    let mut result: Vec<_> = tournaments
        .into_iter()
        .map(|(tournament_id, (coverage, groups))| {
            let groups = groups
                .into_iter()
                .map(|((pot, players, position), counts)| Group {
                    pot,
                    players,
                    position,
                    counts,
                })
                .collect();
            TournamentStats {
                tournament_id,
                coverage,
                groups,
            }
        })
        .collect();
    result.sort_unstable_by(|a, b| a.tournament_id.cmp(&b.tournament_id));
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn flop(cards: &str) -> (Option<Category>, usize, Draws) {
        let cards: Vec<_> = cards
            .split_whitespace()
            .map(|c| parse_card(c).unwrap())
            .collect();
        classify(cards.try_into().unwrap())
    }

    #[test]
    fn made_hands_ignore_board_only_pairs_and_keep_paired_draws() {
        use Category::*;
        for (cards, expected) in [
            ("Ah Kd Ts Tc 7s", None),
            ("Ah Kd Ts Tc Th", None),
            ("Ah Kd As Tc 7s", Some(TopPair)),
            ("Th Kd As Tc 7s", Some(MiddlePair)),
            ("7h Kd As Tc 7s", Some(BottomPair)),
            ("Kh Kd Js Tc 7s", Some(Overpair)),
            ("8h 8d As Tc 7s", Some(Underpair)),
            ("8h 8d As Tc Ts", Some(TwoPairPlus)),
            ("8h 8d As Tc 8s", Some(TwoPairPlus)),
            ("Ah Qh Th 3h 8h", Some(TwoPairPlus)),
            ("Ah 2c 3c 4d 5h", Some(TwoPairPlus)),
        ] {
            assert_eq!(flop(cards).0, expected, "{cards}");
        }
        let mut counts = Counts::default();
        let (made, overs, draws) = flop("9h 8h 9c 7h 6h");
        counts.observe(made, overs, &draws);
        assert_eq!(counts.categories, BTreeMap::from([(TopPair, 1)]));
        assert_eq!(
            (counts.pair_and_direct, counts.combo_draw, counts.connected),
            (1, 1, 1)
        );
    }

    #[test]
    fn identifies_wheel_open_ends_double_gutshots_and_backdoors() {
        assert!(flop("2h 3d 4c 5h Ks").2.oesd);
        assert!(flop("Ah Jd Qc Kh 2s").2.gutshot);
        assert!(flop("6h 8d 9c Th Qs").2.gutshot);
        assert!(flop("Ah 5d 4c 2h Ks").2.gutshot);
        let (made, overs, draws) = flop("Ah Kh Qh 8c 2d");
        assert!(draws.backdoor_flush && draws.backdoor_straight && !draws.direct());
        let mut counts = Counts::default();
        counts.observe(made, overs, &draws);
        assert_eq!(
            counts.categories,
            BTreeMap::from([(Category::TwoOvercards, 1)])
        );
        assert_eq!((counts.no_pair_or_direct, counts.two_overs_or_draw), (1, 1));
        let (_, _, draws) = flop("Kh Kd 3c 4c 5c");
        assert!(!draws.backdoor_flush && !draws.backdoor_straight);
    }

    #[test]
    fn follows_folds_calls_and_all_ins_instead_of_dealt_count() {
        use Outcome::*;
        let mut players: Vec<_> = ["Hero", "SB", "BB"]
            .iter()
            .enumerate()
            .map(|(i, name)| Player {
                name: (*name).into(),
                seat: i as i64 + 1,
                stack: 300,
                hero: i == 0,
            })
            .collect();
        let evaluate = |players: &[Player], actions: &[(&str, &str)]| {
            context(
                players,
                &actions
                    .iter()
                    .map(|(name, kind)| Action((*name).into(), (*kind).into()))
                    .collect::<Vec<_>>(),
                &HashSet::new(),
                1,
                [10, 20],
            )
        };
        assert_eq!(
            evaluate(
                &players,
                &[("Hero", "raise"), ("SB", "fold"), ("BB", "call")]
            ),
            Eligible {
                pot: Pot::Open,
                count: 2
            }
        );
        assert_eq!(
            evaluate(
                &players,
                &[
                    ("SB", "call"),
                    ("Hero", "allin_raise"),
                    ("SB", "call"),
                    ("BB", "allin_call")
                ]
            ),
            Eligible {
                pot: Pot::Iso,
                count: 3
            }
        );
        assert_eq!(
            evaluate(
                &players,
                &[
                    ("Hero", "raise"),
                    ("SB", "fold"),
                    ("BB", "allin_raise"),
                    ("Hero", "call")
                ]
            ),
            Eligible {
                pot: Pot::Reraised,
                count: 2
            }
        );
        assert_eq!(
            evaluate(
                &players,
                &[("Hero", "call"), ("SB", "call"), ("BB", "check")]
            ),
            Eligible {
                pot: Pot::Limped,
                count: 3
            }
        );
        assert_eq!(
            evaluate(
                &players,
                &[
                    ("Hero", "call"),
                    ("SB", "raise"),
                    ("BB", "fold"),
                    ("Hero", "call")
                ]
            ),
            Eligible {
                pot: Pot::OpponentRaise,
                count: 2
            }
        );
        assert_eq!(
            evaluate(
                &players,
                &[
                    ("Hero", "raise"),
                    ("SB", "fold"),
                    ("BB", "raise"),
                    ("Hero", "fold")
                ]
            ),
            Outside
        );
        assert_eq!(
            evaluate(
                &players,
                &[("Hero", "raise"), ("SB", "fold"), ("BB", "fold")]
            ),
            Outside
        );
        assert_eq!(
            evaluate(&players, &[("Hero", "raise"), ("SB", "fold")]),
            Unknown
        );
        players[2].stack = 15;
        assert_eq!(
            evaluate(&players, &[("Hero", "raise"), ("SB", "fold")]),
            Eligible {
                pot: Pot::Open,
                count: 2
            }
        );
        players[0].stack = 18;
        assert_eq!(
            evaluate(&players, &[("Hero", "allin_call"), ("SB", "fold")]),
            Eligible {
                pot: Pot::Limped,
                count: 2
            }
        );
        players[2].stack = 300;
        assert_eq!(
            evaluate(&players, &[("Hero", "allin_call"), ("SB", "fold")]),
            Eligible {
                pot: Pot::Limped,
                count: 2
            }
        );
        players[0].stack = 22;
        assert_eq!(
            evaluate(&players, &[("Hero", "allin_call"), ("SB", "fold")]),
            Unknown
        );
    }

    #[test]
    fn reads_real_histories_and_serializes_exclusive_counts_without_writing() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../files");
        let hh = dir.join("20260609_Expresso(1124670745)_real_holdem_no-limit.txt");
        let summary = dir.join("20260609_Expresso(1124670745)_real_holdem_no-limit_summary.txt");
        let db = hh_ingest::db::open_memory().unwrap();
        hh_ingest::import_tournament_with_conn(
            hh.to_str().unwrap(),
            summary.to_str().unwrap(),
            &db,
            hh_ingest::DEFAULT_HERO,
            None,
        )
        .unwrap();
        db.execute_batch("PRAGMA query_only = ON;").unwrap();
        let stats = get_stats(&db).unwrap();
        assert_eq!(stats.len(), 1);
        let groups = &stats[0].groups;
        assert!(groups.iter().any(|g| g.counts.flops > 0));
        for counts in groups.iter().map(|g| &g.counts) {
            assert_eq!(counts.categories.values().sum::<u32>(), counts.flops);
            assert_eq!(counts.connected + counts.no_pair_or_direct, counts.flops);
        }
        let json = serde_json::to_value(stats).unwrap();
        assert!(json[0]["tournament_id"].is_string());
        assert!(json[0]["groups"][0]["counts"]["connected"].is_number());
    }
}
