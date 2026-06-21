use std::collections::HashMap;
use std::fs;
use std::path::Path;

use hand_ledger::compute_ledger;
use hh_ingest::ev::compute_hero_net_ev;
use hh_parser_winamax::parse_hands;

fn reference_hh_path(tournament_id: &str) -> String {
    let docker_path = format!("/app/files/20260609_Expresso({})_real_holdem_no-limit.txt", tournament_id);
    if Path::new(&docker_path).exists() {
        return docker_path;
    }

    format!(
        "/home/rbernaz/tracker/files/20260609_Expresso({})_real_holdem_no-limit.txt",
        tournament_id
    )
}

#[test]
fn reference_tournament_outputs_match_expected_values() {
    let hh_path = reference_hh_path("1124843609");
    let hh_text = fs::read_to_string(&hh_path).expect("read hh file");
    let (hands, warnings) = parse_hands(hh_text.as_bytes()).expect("parse hh file");
    assert!(warnings.is_empty(), "unexpected warnings: {warnings:?}");

    let hands_by_id: HashMap<_, _> = hands.into_iter().map(|hand| (hand.hand_id.clone(), hand)).collect();

    let fold_hand = hands_by_id
        .get("4831166513769611265-4-1781012906")
        .expect("reference fold hand");
    let fold_ledger = compute_ledger(fold_hand);
    assert_eq!(compute_hero_net_ev(fold_hand, &fold_ledger, "MRZO"), None);

    let allin_cases = [
        ("4831166513769611265-7-1781012965", 28_i64, 0.5323_f64),
        ("4831166513769611265-29-1781013145", 305_i64, 0.6532_f64),
        ("4831166513769611265-30-1781013156", 2_i64, 0.9016_f64),
    ];

    for (hand_id, expected_net_ev, expected_eq) in allin_cases {
        let hand = hands_by_id.get(hand_id).expect("reference all-in hand");
        let ledger = compute_ledger(hand);
        let (net_ev, eq) = compute_hero_net_ev(hand, &ledger, "MRZO").expect("expected net ev");

        assert_eq!(net_ev, expected_net_ev, "unexpected net ev for {hand_id}");
        assert!(
            (eq - expected_eq).abs() < 0.0001,
            "unexpected equity for {hand_id}: got {eq:.4}, expected {expected_eq:.4}"
        );
    }
}