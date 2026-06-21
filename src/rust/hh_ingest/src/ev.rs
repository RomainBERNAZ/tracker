use hand_ledger::HandLedger;
use hh_parser_winamax::{ParsedHand, StreetType};
use rs_poker::core::{Card as PokerCard, Rank as PokerRank, Rankable, Suit as PokerSuit, Value as PokerValue};
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

fn to_poker_card(card: Card) -> PokerCard {
    let value = match card.rank {
        2 => PokerValue::Two,
        3 => PokerValue::Three,
        4 => PokerValue::Four,
        5 => PokerValue::Five,
        6 => PokerValue::Six,
        7 => PokerValue::Seven,
        8 => PokerValue::Eight,
        9 => PokerValue::Nine,
        10 => PokerValue::Ten,
        11 => PokerValue::Jack,
        12 => PokerValue::Queen,
        13 => PokerValue::King,
        14 => PokerValue::Ace,
        _ => unreachable!("invalid rank"),
    };

    let suit = match card.suit {
        0 => PokerSuit::Club,
        1 => PokerSuit::Diamond,
        2 => PokerSuit::Heart,
        3 => PokerSuit::Spade,
        _ => unreachable!("invalid suit"),
    };

    PokerCard::new(value, suit)
}

fn best_score_7(cards: &[Card; 7]) -> PokerRank {
    let poker_cards: Vec<PokerCard> = cards.iter().copied().map(to_poker_card).collect();
    poker_cards.rank()
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
    let samples = recommended_samples(contenders.len(), to_draw);
    let expected_collect = monte_carlo_equity_multiway(
        hero_name,
        &contenders,
        ledger,
        &known_board,
        &deck,
        to_draw,
        samples,
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


fn next_u64(state: &mut u64) -> u64 {
    // xorshift64*
    let mut x = *state;
    x ^= x >> 12;
    x ^= x << 25;
    x ^= x >> 27;
    *state = x;
    x.wrapping_mul(2685821657736338717)
}

#[derive(Clone)]
struct PotTier {
    chips: f64,
    eligible: Vec<usize>,
}

fn recommended_samples(contenders_count: usize, to_draw: usize) -> usize {
    if to_draw == 0 {
        return 1;
    }
    if contenders_count <= 2 {
        match to_draw {
            1 => 4_000,
            2 => 6_000,
            3 => 8_000,
            _ => 12_000,
        }
    } else {
        match to_draw {
            1 => 6_000,
            2 => 8_000,
            3 => 12_000,
            _ => 16_000,
        }
    }
}

fn exact_expected_collect_multiway(
    hero_idx: usize,
    contenders: &[(String, Card, Card, u64)],
    tiers: &[PotTier],
    known_board: &[Card],
    deck: &[Card],
    to_draw: usize,
) -> Option<f64> {
    if known_board.len() > 5 || to_draw > 5 || known_board.len() + to_draw != 5 {
        return None;
    }

    let mut total_collect = 0.0f64;
    let mut total = 0u64;

    if to_draw == 0 {
        let board = [known_board[0], known_board[1], known_board[2], known_board[3], known_board[4]];
        return Some(hero_expected_collect_for_board(hero_idx, contenders, tiers, &board));
    }

    if to_draw == 1 {
        for c in deck {
            let board = [known_board[0], known_board[1], known_board[2], known_board[3], *c];
            total_collect += hero_expected_collect_for_board(hero_idx, contenders, tiers, &board);
            total += 1;
        }
        return if total == 0 { None } else { Some(total_collect / total as f64) };
    }

    if to_draw == 2 {
        for i in 0..deck.len().saturating_sub(1) {
            for j in (i + 1)..deck.len() {
                let board = [known_board[0], known_board[1], known_board[2], deck[i], deck[j]];
                total_collect += hero_expected_collect_for_board(hero_idx, contenders, tiers, &board);
                total += 1;
            }
        }
        return if total == 0 { None } else { Some(total_collect / total as f64) };
    }

    None
}

fn build_pot_tiers(contenders: &[(String, Card, Card, u64)], ledger: &HandLedger) -> Vec<PotTier> {
    let mut levels = contenders
        .iter()
        .map(|(_, _, _, c)| *c)
        .filter(|c| *c > 0)
        .collect::<Vec<_>>();
    levels.sort_unstable();
    levels.dedup();

    let mut prev = 0u64;
    let mut tiers = Vec::new();
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

        let mut eligible = Vec::new();
        for (idx, (_, _, _, contrib)) in contenders.iter().enumerate() {
            if *contrib >= level {
                eligible.push(idx);
            }
        }
        if !eligible.is_empty() {
            tiers.push(PotTier {
                chips: pot_tier as f64,
                eligible,
            });
        }
        prev = level;
    }
    tiers
}

fn hero_expected_collect_for_board(
    hero_idx: usize,
    contenders: &[(String, Card, Card, u64)],
    tiers: &[PotTier],
    board: &[Card; 5],
) -> f64 {
    let mut scores = Vec::with_capacity(contenders.len());
    for (_, c1, c2, _) in contenders {
        let cards7 = [*c1, *c2, board[0], board[1], board[2], board[3], board[4]];
        scores.push(best_score_7(&cards7));
    }

    let mut hero_collect = 0.0f64;
    for tier in tiers {
        let mut best = scores[tier.eligible[0]];
        for idx in &tier.eligible {
            let s = scores[*idx];
            if s > best {
                best = s;
            }
        }

        let mut winners = 0usize;
        let mut hero_wins = false;
        for idx in &tier.eligible {
            if scores[*idx] == best {
                winners += 1;
                if *idx == hero_idx {
                    hero_wins = true;
                }
            }
        }

        if hero_wins && winners > 0 {
            hero_collect += tier.chips / winners as f64;
        }
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

    let hero_idx = contenders.iter().position(|(n, _, _, _)| n == hero_name)?;
    let tiers = build_pot_tiers(contenders, ledger);

    // Exact enumeration is cheaper and more stable when only turn/river are unknown.
    if to_draw <= 2 {
        return exact_expected_collect_multiway(hero_idx, contenders, &tiers, known_board, deck, to_draw);
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
        expected_collect += hero_expected_collect_for_board(hero_idx, contenders, &tiers, &board);
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
