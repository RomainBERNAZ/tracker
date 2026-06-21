pub mod error;
pub mod parser;
pub mod summary_parser;
pub mod types;

pub use error::ParseError;
pub use parser::parse_hands;
pub use summary_parser::parse_tournament_summary;
pub use types::*;

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_HAND: &str = r#"Winamax Poker - Tournament "Expresso" buyIn: 1.86€ + 0.14€ level: 1 - HandId: #4829108511470256129-1-1780949140 - Holdem no limit (10/20) - 2026/06/08 20:05:40 UTC
Table: 'Expresso(1124364443)#0' 3-max (real money) Seat #2 is the button
Seat 1: KeDuBluff_2A (500)
Seat 2: MRZO (500)
Seat 3: Le Yoyo14510 (500)
*** ANTE/BLINDS ***
Le Yoyo14510 posts small blind 10
KeDuBluff_2A posts big blind 20
Dealt to MRZO [4c Ah]
*** PRE-FLOP *** 
MRZO raises 20 to 40
Le Yoyo14510 calls 30
KeDuBluff_2A calls 20
*** FLOP *** [9d 9h Td]
Le Yoyo14510 checks
KeDuBluff_2A checks
MRZO checks
*** TURN *** [9d 9h Td][Kh]
Le Yoyo14510 checks
KeDuBluff_2A bets 78
MRZO folds
Le Yoyo14510 raises 78 to 156
KeDuBluff_2A calls 78
*** RIVER *** [9d 9h Td Kh][3h]
Le Yoyo14510 bets 304 and is all-in
KeDuBluff_2A calls 304 and is all-in
*** SHOW DOWN ***
Le Yoyo14510 shows [Kd Jd] (Two pairs : Kings and 9)
KeDuBluff_2A shows [4h 5h] (Flush King high)
KeDuBluff_2A collected 1040 from pot
*** SUMMARY ***
Total pot 1040 | No rake
Board: [9d 9h Td Kh 3h]
Seat 1: KeDuBluff_2A (big blind) showed [4h 5h] and won 1040 with Flush King high
Seat 3: Le Yoyo14510 (small blind) showed [Kd Jd] and lost with Two pairs : Kings and 9
"#;

    const SAMPLE_SUMMARY: &str = r#"Winamax Poker - Tournament summary : Expresso(1124364443)
Player : MRZO
Buy-In : 1.86€ + 0.14€
Registered players : 3
Mode : sng
Type : sitngo
Speed : turbo
Flight ID : 0
Prizepool : 20€
Tournament started 2026/06/08 20:05:29 UTC
You played 5min 13s 
You finished in 2nd place
"#;

    #[test]
    fn test_parse_single_hand() {
        let (hands, warnings) = parse_hands(SAMPLE_HAND.as_bytes()).unwrap();
        assert_eq!(hands.len(), 1, "should parse exactly 1 hand");
        let h = &hands[0];

        assert_eq!(h.hand_id, "4829108511470256129-1-1780949140");
        assert_eq!(h.tournament_id, "4829108511470256129");
        assert_eq!(h.small_blind, 10);
        assert_eq!(h.big_blind, 20);
        assert_eq!(h.button_seat, 2);
        assert_eq!(h.seats.len(), 3);
        assert_eq!(h.seats[1].player_name, "MRZO");
        assert_eq!(h.seats[1].stack, 500);

        // Hero cards
        let hc = h.hero_cards.as_ref().unwrap();
        assert_eq!(hc.card1, "4c");
        assert_eq!(hc.card2, "Ah");

        // Blinds
        assert_eq!(h.blinds.len(), 2);
        assert_eq!(h.blinds[0].blind_type, BlindType::SmallBlind);
        assert_eq!(h.blinds[0].amount, 10);

        // Streets
        assert_eq!(h.streets.len(), 4); // PreFlop, Flop, Turn, River

        // Summary
        assert_eq!(h.summary.total_pot, 1040);
        assert_eq!(h.summary.rake, 0);
        assert_eq!(h.summary.board.len(), 5);

        assert!(warnings.is_empty(), "unexpected warnings: {:?}", warnings);
    }

    #[test]
    fn test_parse_tournament_summary() {
        let ts = parse_tournament_summary(SAMPLE_SUMMARY).unwrap();
        assert_eq!(ts.tournament_id, "1124364443");
        assert_eq!(ts.player_name, "MRZO");
        assert!((ts.buy_in_euros - 1.86).abs() < 0.001);
        assert!((ts.prizepool_euros - 20.0).abs() < 0.001);
        assert_eq!(ts.multiplier, 10);
        assert_eq!(ts.finish_position, 2);
        assert_eq!(ts.duration_secs, 313); // 5*60+13
    }

    #[test]
    fn test_mrzo_folds_action() {
        let (hands, _) = parse_hands(SAMPLE_HAND.as_bytes()).unwrap();
        let h = &hands[0];
        let turn = h.streets.iter().find(|s| s.street_type == StreetType::Turn).unwrap();
        let mrzo_fold = turn
            .actions
            .iter()
            .find(|a| a.player_name == "MRZO")
            .unwrap();
        assert!(matches!(mrzo_fold.action, Action::Fold));
    }

    #[test]
    fn test_all_in_actions() {
        let (hands, _) = parse_hands(SAMPLE_HAND.as_bytes()).unwrap();
        let h = &hands[0];
        let river = h.streets.iter().find(|s| s.street_type == StreetType::River).unwrap();
        assert_eq!(river.actions.len(), 2);
        assert!(matches!(river.actions[0].action, Action::AllInBet { amount: 304 }));
        assert!(matches!(river.actions[1].action, Action::AllInCall { amount: 304 }));
    }
}
