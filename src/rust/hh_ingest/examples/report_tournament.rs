use std::fs;

use hand_ledger::compute_ledger;
use hh_ingest::ev::compute_hero_net_ev;
use hh_parser_winamax::parse_hands;

fn main() {
    let tournament_id = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "1124843609".to_string());

    let candidates = [
        format!("/app/files/20260609_Expresso({})_real_holdem_no-limit.txt", tournament_id),
        format!(
            "/home/rbernaz/tracker/files/20260609_Expresso({})_real_holdem_no-limit.txt",
            tournament_id
        ),
    ];
    let hh_path = candidates
        .iter()
        .find(|p| std::path::Path::new(p.as_str()).exists())
        .expect("hh path");

    let hh_text = fs::read_to_string(hh_path).expect("read hh file");
    let (hands, warnings) = parse_hands(hh_text.as_bytes()).expect("parse hh");

    if !warnings.is_empty() {
        eprintln!("warnings: {}", warnings.len());
    }

    println!("hand_id;timestamp_utc;bb;hero_cards;pot;hero_cev;hero_net_ev;hero_allin_eq");

    for hand in hands {
        let ledger = compute_ledger(&hand);
        let hero = ledger
            .players
            .iter()
            .find(|p| p.player_name == "MRZO");

        let (hero_cev, cards) = if let Some(h) = hero {
            let cards = hand
                .hero_cards
                .as_ref()
                .map(|hc| format!("{} {}", hc.card1, hc.card2))
                .unwrap_or_else(|| "".to_string());
            (h.realized_cev, cards)
        } else {
            (0_i64, "".to_string())
        };

        let ev = compute_hero_net_ev(&hand, &ledger, "MRZO");
        let (net_ev, eq) = ev
            .map(|(n, e)| (n.to_string(), format!("{:.4}", e)))
            .unwrap_or_else(|| (hero_cev.to_string(), "".to_string()));

        println!(
            "{};{};{};{};{};{};{};{}",
            hand.hand_id,
            hand.timestamp.to_rfc3339(),
            hand.big_blind,
            cards,
            hand.summary.total_pot,
            hero_cev,
            net_ev,
            eq
        );
    }
}
