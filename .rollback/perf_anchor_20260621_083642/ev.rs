use hand_ledger::HandLedger;
use hh_parser_winamax::{ParsedHand, StreetType};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

#[derive(Debug, Clone, Copy)]
struct Card {
    rank: u8, // 2..14
    suit: u8, // 0..3
}

fn parse_card(s: &str) -> Option<Card> {
    if s.len() != 2 {
        return None;
    }
    let b = s.as_bytes();
    let rank = match b[0] as char {
        '2' => 2,
        '3' => 3,
        '4' => 4,
        '5' => 5,
        '6' => 6,
        '7' => 7,
        '8' => 8,
        '9' => 9,
        'T' => 10,
        'J' => 11,
        'Q' => 12,
        'K' => 13,
        'A' => 14,
        _ => return None,
    };
    let suit = match b[1] as char {
        'c' => 0,
        'd' => 1,
        'h' => 2,
        's' => 3,
        _ => return None,
    };
    Some(Card { rank, suit })
}

fn deck_without(used: &[Card]) -> Vec<Card> {
    let mut deck = Vec::with_capacity(52 - used.len());
    for rank in 2..=14 {
        for suit in 0..=3 {
            let c = Card { rank, suit };
            if !used.iter().any(|u| u.rank == c.rank && u.suit == c.suit) {
                deck.push(c);
            }
        }
    }
    deck
}

fn score_5(cards: &[Card; 5]) -> u64 {
    let mut ranks = [0u8; 5];
    let mut suits = [0u8; 5];
    for (i, c) in cards.iter().enumerate() {
        ranks[i] = c.rank;
        suits[i] = c.suit;
    }
    ranks.sort_unstable_by(|a, b| b.cmp(a));

    let is_flush = suits.iter().all(|s| *s == suits[0]);

    let mut uniq = ranks.to_vec();
    uniq.sort_unstable();
    uniq.dedup();

    let straight_high = if uniq.len() == 5 {
        let min = *uniq.first().unwrap_or(&0);
        let max = *uniq.last().unwrap_or(&0);
        if max - min == 4 {
            Some(max)
        } else if uniq == vec![2, 3, 4, 5, 14] {
            Some(5)
        } else {
            None
        }
    } else {
        None
    };

    let mut count_by_rank = [0u8; 15];
    for r in ranks {
        count_by_rank[r as usize] += 1;
    }

    let mut groups: Vec<(u8, u8)> = (2..=14)
        .filter_map(|r| {
            let c = count_by_rank[r as usize];
            if c > 0 { Some((c, r as u8)) } else { None }
        })
        .collect();
    groups.sort_unstable_by(|a, b| b.cmp(a));

    let mut encode = |category: u8, kickers: &[u8]| -> u64 {
        let mut v = (category as u64) << 24;
        for (i, k) in kickers.iter().enumerate() {
            v |= (*k as u64) << (4 * (5 - i));
        }
        v
    };

    if is_flush && straight_high.is_some() {
        return encode(8, &[straight_high.unwrap()]);
    }

    if groups[0].0 == 4 {
        let four = groups[0].1;
        let kicker = groups[1].1;
        return encode(7, &[four, kicker]);
    }

    if groups[0].0 == 3 && groups[1].0 == 2 {
        return encode(6, &[groups[0].1, groups[1].1]);
    }

    if is_flush {
        let mut r = cards.iter().map(|c| c.rank).collect::<Vec<_>>();
        r.sort_unstable_by(|a, b| b.cmp(a));
        return encode(5, &r);
    }

    if let Some(h) = straight_high {
        return encode(4, &[h]);
    }

    if groups[0].0 == 3 {
        let trips = groups[0].1;
        let mut kick = groups
            .iter()
            .filter(|(c, _)| *c == 1)
            .map(|(_, r)| *r)
            .collect::<Vec<_>>();
        kick.sort_unstable_by(|a, b| b.cmp(a));
        return encode(3, &[trips, kick[0], kick[1]]);
    }

    if groups[0].0 == 2 && groups[1].0 == 2 {
        let p1 = groups[0].1.max(groups[1].1);
        let p2 = groups[0].1.min(groups[1].1);
        let k = groups.iter().find(|(c, _)| *c == 1).map(|(_, r)| *r).unwrap_or(0);
        return encode(2, &[p1, p2, k]);
    }

    if groups[0].0 == 2 {
        let p = groups[0].1;
        let mut kick = groups
            .iter()
            .filter(|(c, _)| *c == 1)
            .map(|(_, r)| *r)
            .collect::<Vec<_>>();
        kick.sort_unstable_by(|a, b| b.cmp(a));
        return encode(1, &[p, kick[0], kick[1], kick[2]]);
    }

    let mut hi = cards.iter().map(|c| c.rank).collect::<Vec<_>>();
    hi.sort_unstable_by(|a, b| b.cmp(a));
    encode(0, &hi)
}

fn best_score_7(cards: &[Card; 7]) -> u64 {
    let idx = [0usize, 1, 2, 3, 4, 5, 6];
    let mut best = 0u64;
    for a in 0..3 {
        for b in (a + 1)..4 {
            for c in (b + 1)..5 {
                for d in (c + 1)..6 {
                    for e in (d + 1)..7 {
                        let five = [cards[idx[a]], cards[idx[b]], cards[idx[c]], cards[idx[d]], cards[idx[e]]];
                        let s = score_5(&five);
                        if s > best {
                            best = s;
                        }
                    }
                }
            }
        }
    }
    best
}

fn known_board_at_allin(hand: &ParsedHand) -> Vec<Card> {
    let mut known = Vec::new();
    let mut allin_street: Option<StreetType> = None;

    for st in &hand.streets {
        if st.actions.iter().any(|a| matches!(a.action, hh_parser_winamax::Action::AllInBet { .. } | hh_parser_winamax::Action::AllInCall { .. } | hh_parser_winamax::Action::AllInRaise { .. })) {
            allin_street = Some(st.street_type.clone());
            break;
        }
    }

    let Some(target) = allin_street else {
        return known;
    };

    for st in &hand.streets {
        if st.street_type == StreetType::PreFlop {
            if target == StreetType::PreFlop {
                break;
            }
            continue;
        }

        for c in &st.new_board_cards {
            if let Some(card) = parse_card(c) {
                known.push(card);
            }
        }

        if st.street_type == target {
            break;
        }
    }

    known
}

pub fn compute_hero_net_ev(hand: &ParsedHand, ledger: &HandLedger, hero_name: &str) -> Option<(i64, f64)> {
    // V0.2 scope: showdown with known hole cards for hero and opponents.
    let showdown = hand.showdown.as_ref()?;
    if showdown.shown_hands.len() < 2 {
        return None;
    }

    if !showdown.shown_hands.iter().any(|s| s.player_name == hero_name) {
        return None;
    }

    let hero_hole = hand.hero_cards.as_ref()?;
    if hero_hole.player_name != hero_name {
        return None;
    }

    let hero_was_all_in = hand.streets.iter().any(|street| {
        street.actions.iter().any(|action| {
            action.player_name == hero_name
                && matches!(
                    action.action,
                    hh_parser_winamax::Action::AllInBet { .. }
                        | hh_parser_winamax::Action::AllInCall { .. }
                        | hh_parser_winamax::Action::AllInRaise { .. }
                )
        })
    });

    if !hero_was_all_in {
        return None;
    }

    let hero_ledger = ledger.players.iter().find(|p| p.player_name == hero_name)?;

    let hero_c1 = parse_card(&hero_hole.card1)?;
    let hero_c2 = parse_card(&hero_hole.card2)?;

    let mut contenders: Vec<(String, Card, Card, u64)> = Vec::new();
    for shown in &showdown.shown_hands {
        let (c1, c2) = if shown.player_name == hero_name {
            (hero_c1, hero_c2)
        } else {
            (parse_card(&shown.card1)?, parse_card(&shown.card2)?)
        };
        let contrib = ledger
            .players
            .iter()
            .find(|p| p.player_name == shown.player_name)
            .map(|p| p.contributions)?;
        contenders.push((shown.player_name.clone(), c1, c2, contrib));
    }

    let known_board = known_board_at_allin(hand);
    if known_board.len() > 5 {
        return None;
    }

    let to_draw = 5usize.saturating_sub(known_board.len());

    let hero_contrib = hero_ledger.contributions as f64;
    if hero_contrib <= 0.0 {
        return None;
    }

    let used = {
        let mut v = vec![hero_c1, hero_c2];
        for (name, c1, c2, _) in &contenders {
            if name != hero_name {
                v.push(*c1);
                v.push(*c2);
            }
        }
        v.extend_from_slice(&known_board);
        v
    };

    let deck = deck_without(&used);
    let mut hasher = DefaultHasher::new();
    hand.hand_id.hash(&mut hasher);
    let seed = hasher.finish();
    let expected_collect = monte_carlo_equity_multiway(
        hero_name,
        &contenders,
        ledger,
        &known_board,
        &deck,
        to_draw,
        30_000,
        seed,
    )?;

    let total_pot = ledger.total_pot as f64;
    if total_pot <= 0.0 {
        return None;
    }

    let net_ev = (expected_collect - hero_contrib).round() as i64;
    let equity = expected_collect / total_pot;
    Some((net_ev, equity))
}

fn exact_equity_heads_up(
    hero_c1: Card,
    hero_c2: Card,
    vil_c1: Card,
    vil_c2: Card,
    known_board: &[Card],
    deck: &[Card],
    to_draw: usize,
) -> Option<f64> {
    if known_board.len() > 5 || to_draw > 5 || known_board.len() + to_draw != 5 {
        return None;
    }

    if to_draw == 0 {
        let board = [known_board[0], known_board[1], known_board[2], known_board[3], known_board[4]];
        let hero7 = [hero_c1, hero_c2, board[0], board[1], board[2], board[3], board[4]];
        let vil7 = [vil_c1, vil_c2, board[0], board[1], board[2], board[3], board[4]];
        let hs = best_score_7(&hero7);
        let vs = best_score_7(&vil7);
        return Some(if hs > vs { 1.0 } else if hs == vs { 0.5 } else { 0.0 });
    }

    let mut chosen: Vec<Card> = vec![Card { rank: 2, suit: 0 }; to_draw];
    let mut hero_wins = 0f64;
    let mut total = 0u64;

    fn rec(
        start: usize,
        depth: usize,
        to_draw: usize,
        deck: &[Card],
        chosen: &mut [Card],
        known_board: &[Card],
        hero_c1: Card,
        hero_c2: Card,
        vil_c1: Card,
        vil_c2: Card,
        hero_wins: &mut f64,
        total: &mut u64,
    ) {
        if depth == to_draw {
            let mut board = Vec::with_capacity(5);
            board.extend_from_slice(known_board);
            board.extend_from_slice(&chosen[..to_draw]);

            let hero7 = [hero_c1, hero_c2, board[0], board[1], board[2], board[3], board[4]];
            let vil7 = [vil_c1, vil_c2, board[0], board[1], board[2], board[3], board[4]];
            let hs = best_score_7(&hero7);
            let vs = best_score_7(&vil7);

            *total += 1;
            if hs > vs {
                *hero_wins += 1.0;
            } else if hs == vs {
                *hero_wins += 0.5;
            }
            return;
        }

        let need = to_draw - depth;
        for i in start..=deck.len() - need {
            chosen[depth] = deck[i];
            rec(
                i + 1,
                depth + 1,
                to_draw,
                deck,
                chosen,
                known_board,
                hero_c1,
                hero_c2,
                vil_c1,
                vil_c2,
                hero_wins,
                total,
            );
        }
    }

    rec(
        0,
        0,
        to_draw,
        deck,
        &mut chosen,
        known_board,
        hero_c1,
        hero_c2,
        vil_c1,
        vil_c2,
        &mut hero_wins,
        &mut total,
    );

    if total == 0 {
        None
    } else {
        Some(hero_wins / total as f64)
    }
}

fn next_u64(state: &mut u64) -> u64 {
    // xorshift64*
    let mut x = *state;
    x ^= x >> 12;
    x ^= x << 25;
    x ^= x >> 27;
    *state = x;
    x.wrapping_mul(2685821657736338717)
}

fn monte_carlo_equity_heads_up(
    hero_c1: Card,
    hero_c2: Card,
    vil_c1: Card,
    vil_c2: Card,
    known_board: &[Card],
    deck: &[Card],
    to_draw: usize,
    samples: usize,
    seed: u64,
) -> Option<f64> {
    if known_board.len() > 5 || to_draw > 5 || known_board.len() + to_draw != 5 || deck.len() < to_draw {
        return None;
    }

    if to_draw == 0 {
        return exact_equity_heads_up(hero_c1, hero_c2, vil_c1, vil_c2, known_board, deck, 0);
    }

    let mut rng = if seed == 0 { 0x9e3779b97f4a7c15 } else { seed };
    let mut hero_wins = 0.0f64;

    for _ in 0..samples {
        let mut tmp = deck.to_vec();
        for i in 0..to_draw {
            let rem = tmp.len() - i;
            let j = i + (next_u64(&mut rng) as usize % rem);
            tmp.swap(i, j);
        }

        let mut board = Vec::with_capacity(5);
        board.extend_from_slice(known_board);
        board.extend_from_slice(&tmp[..to_draw]);

        let hero7 = [hero_c1, hero_c2, board[0], board[1], board[2], board[3], board[4]];
        let vil7 = [vil_c1, vil_c2, board[0], board[1], board[2], board[3], board[4]];
        let hs = best_score_7(&hero7);
        let vs = best_score_7(&vil7);
        if hs > vs {
            hero_wins += 1.0;
        } else if hs == vs {
            hero_wins += 0.5;
        }
    }

    Some(hero_wins / samples as f64)
}

fn hero_expected_collect_for_board(
    hero_name: &str,
    contenders: &[(String, Card, Card, u64)],
    ledger: &HandLedger,
    board: &[Card; 5],
) -> f64 {
    let mut scored: Vec<(&str, u64, u64)> = Vec::with_capacity(contenders.len());
    for (name, c1, c2, contrib) in contenders {
        let cards7 = [*c1, *c2, board[0], board[1], board[2], board[3], board[4]];
        scored.push((name.as_str(), *contrib, best_score_7(&cards7)));
    }

    let mut levels = scored.iter().map(|(_, c, _)| *c).filter(|c| *c > 0).collect::<Vec<_>>();
    levels.sort_unstable();
    levels.dedup();

    let mut hero_collect = 0.0f64;
    let mut prev = 0u64;

    for level in levels {
        if level <= prev {
            continue;
        }

        let pot_tier: u64 = ledger
            .players
            .iter()
            .map(|p| p.contributions.min(level).saturating_sub(prev))
            .sum();

        if pot_tier == 0 {
            prev = level;
            continue;
        }

        let eligible = scored
            .iter()
            .filter(|(_, c, _)| *c >= level)
            .collect::<Vec<_>>();
        if eligible.is_empty() {
            prev = level;
            continue;
        }

        let best = eligible.iter().map(|(_, _, s)| *s).max().unwrap_or(0);
        let winners = eligible
            .iter()
            .filter(|(_, _, s)| *s == best)
            .map(|(n, _, _)| *n)
            .collect::<Vec<_>>();
        if winners.is_empty() {
            prev = level;
            continue;
        }

        let share = pot_tier as f64 / winners.len() as f64;
        if winners.iter().any(|n| *n == hero_name) {
            hero_collect += share;
        }

        prev = level;
    }

    hero_collect
}

fn monte_carlo_equity_multiway(
    hero_name: &str,
    contenders: &[(String, Card, Card, u64)],
    ledger: &HandLedger,
    known_board: &[Card],
    deck: &[Card],
    to_draw: usize,
    samples: usize,
    seed: u64,
) -> Option<f64> {
    if known_board.len() > 5 || to_draw > 5 || known_board.len() + to_draw != 5 || deck.len() < to_draw {
        return None;
    }

    let mut rng = if seed == 0 { 0x9e3779b97f4a7c15 } else { seed };
    let mut expected_collect = 0.0f64;

    for _ in 0..samples {
        let mut tmp = deck.to_vec();
        for i in 0..to_draw {
            let rem = tmp.len() - i;
            let j = i + (next_u64(&mut rng) as usize % rem);
            tmp.swap(i, j);
        }

        let mut board_vec = Vec::with_capacity(5);
        board_vec.extend_from_slice(known_board);
        board_vec.extend_from_slice(&tmp[..to_draw]);
        let board = [board_vec[0], board_vec[1], board_vec[2], board_vec[3], board_vec[4]];
        expected_collect += hero_expected_collect_for_board(hero_name, contenders, ledger, &board);
    }

    Some(expected_collect / samples as f64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use hand_ledger::compute_ledger;
    use hh_parser_winamax::parse_hands;

    const HERO_FOLDS_BEFORE_SHOWDOWN: &str = r#"Winamax Poker - Tournament "Expresso" buyIn: 1.86€ + 0.14€ level: 1 - HandId: #4831166513769611265-4-1781012906 - Holdem no limit (10/20) - 2026/06/09 13:48:26 UTC
Table: 'Expresso(1124843609)#0' 3-max (real money) Seat #2 is the button
Seat 1: Cocochanel23 (422)
Seat 2: MRZO (578)
Seat 3: KrtASmuertAS (500)
*** ANTE/BLINDS ***
KrtASmuertAS posts small blind 10
Cocochanel23 posts big blind 20
Dealt to MRZO [5d 5c]
*** PRE-FLOP *** 
MRZO raises 20 to 40
KrtASmuertAS calls 30
Cocochanel23 raises 382 to 422 and is all-in
MRZO folds
KrtASmuertAS calls 382
*** FLOP *** [Qs 3d 8h]
*** TURN *** [Qs 3d 8h][7c]
*** RIVER *** [Qs 3d 8h 7c][Ah]
*** SHOW DOWN ***
KrtASmuertAS shows [Ks Td] (High card : Ace)
Cocochanel23 shows [Ad 3s] (Two pairs : Aces and 3)
Cocochanel23 collected 884 from pot
*** SUMMARY ***
Total pot 884 | No rake
Board: [Qs 3d 8h 7c Ah]
Seat 1: Cocochanel23 (big blind) showed [Ad 3s] and won 884 with Two pairs : Aces and 3
Seat 3: KrtASmuertAS (small blind) showed [Ks Td] and lost with High card : Ace
"#;

    #[test]
    fn parse_card_works() {
        let c = parse_card("Kd").expect("card");
        assert_eq!(c.rank, 13);
        assert_eq!(c.suit, 1);
    }

    #[test]
    fn hero_fold_before_showdown_has_no_net_ev() {
        let (hands, warnings) = parse_hands(HERO_FOLDS_BEFORE_SHOWDOWN.as_bytes()).expect("parse hand");
        assert!(warnings.is_empty(), "unexpected warnings: {warnings:?}");
        let hand = hands.first().expect("parsed hand");
        let ledger = compute_ledger(hand);

        let net_ev = compute_hero_net_ev(hand, &ledger, "MRZO");
        assert!(net_ev.is_none(), "hero folded before showdown, so Net EV must be absent");
    }
}
