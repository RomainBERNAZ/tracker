# UI Specification V0.1

## Overview

V0.1 UI is **minimal and factual**: Import hands, view sessions, inspect hand details with realized cEV.

No GTO, no solvers, no advanced analytics — just clear presentation of data.

---

## Design Principles

1. **Factual first**: Show what happened, not what "should" have happened
2. **Clear hierarchy**: Import > Sessions > Hands > Detail
3. **No clutter**: Remove non-essential elements
4. **Responsive**: Support 1024×768 and up
5. **Accessible**: WCAG AA contrast, keyboard navigation

---

## Screen 1: Import

### Layout

```
┌─────────────────────────────────────────────────┐
│ Expresso Review — V0.1                     [≡]  │ Title bar
├─────────────────────────────────────────────────┤
│                                                  │
│  IMPORT HAND HISTORY                             │
│                                                  │
│  ┌───────────────────────────────────────────┐  │
│  │  ↓  Drop file here or  [Browse]           │  │ Drop zone
│  │                                            │  │
│  │  .txt (Winamax) supported                 │  │
│  └───────────────────────────────────────────┘  │
│                                                  │
│  ╭─────────────────────────────────────────╮    │
│  │████████░░░░░░░░░░░░░ 42%  (5/12k)       │    │ Progress bar
│  │ 1,234 hands/sec │ ≈ 45s remaining       │    │ Stats
│  ╰─────────────────────────────────────────╯    │
│                                                  │
│  Errors (3 / 12000):                           │ Errors panel
│  • Line 42: Unknown action "super_fold"        │
│  • Line 156: Missing player name               │
│  • Line 203: Invalid stack value "abc"         │
│                                                  │
│  [Cancel] [Done]                               │ Buttons
└─────────────────────────────────────────────────┘
```

### Features

- **Drag & drop**: Accepts `.txt` files only
- **Browse button**: File picker as fallback
- **Progress bar**: Real-time % complete
- **Live metrics**: Hands/sec, estimated time remaining
- **Error summary**: First N errors (scrollable)
- **Cancel button**: Graceful abort + cleanup
- **Done button**: Appears after import complete (enabled if >0 hands)

### States

| State | Display | Actions |
|-------|---------|---------|
| **Idle** | Drop zone visible | Drag/drop or browse |
| **Parsing** | Progress bar filling, metrics | Cancel |
| **Done** | 100%, summary | Done, or import another |
| **Error** | Partial progress, error list | Retry, Cancel |

### Metrics Shown

- **Current throughput**: hands/sec (rolling average)
- **Elapsed time**: [mm:ss]
- **Estimated remaining**: [mm:ss]
- **Files queued**: (if multiple)
- **Error count**: [N/total]

---

## Screen 2: Sessions

### Layout

```
┌─────────────────────────────────────────────────┐
│ Expresso Review — Sessions               [+][≡] │
├─────────────────────────────────────────────────┤
│                                                  │
│ Filter: [All ▼]  Search: [________]  [Refresh]  │ Controls
│                                                  │
│ Date       │ Game    │ Hands │ P&L   │ Avg/Hand│ Headers
│────────────┼─────────┼───────┼───────┼─────────│
│ 2026-06-19 │ 3x cash │  342  │+85.50│+0.25    │ Row 1
│ 2026-06-18 │ 3x cash │  156  │-12.00│-0.07    │ Row 2
│ 2026-06-17 │ 3x cash │  289  │+45.25│+0.15    │ Row 3
│ ...        │ ...     │ ...   │ ...   │ ...     │
│                                                  │
│ Total: 5,234 hands | Avg P&L: +5.20/session    │ Footer
└─────────────────────────────────────────────────┘
```

### Features

- **Sortable columns**: Click header to sort (↑ ↓)
- **Filters**:
  - Date range picker
  - Game type (Expresso 3x, ...)
- **Search**: By table name or partial date
- **Refresh**: Re-query if new hands added
- **Row click**: Go to hand list for that session
- **Totals row**: Aggregate stats

### Columns

| Column | Format | Alignment |
|--------|--------|-----------|
| **Date** | YYYY-MM-DD | Left |
| **Game** | "Expresso 3x" | Left |
| **Hands** | 342 | Right |
| **P&L** | +85.50 or -12.00 (colored) | Right |
| **Avg/Hand** | +0.25 (green) or -0.07 (red) | Right |

### Color Coding

- **P&L > 0**: Green (#10b981)
- **P&L < 0**: Red (#ef4444)
- **P&L = 0**: Gray (#9ca3af)

---

## Screen 3: Hand List (by Session)

### Layout

```
┌────────────────────────────────────────────────┐
│ ← Expresso Review — Session 2026-06-19    [≡]  │
├────────────────────────────────────────────────┤
│                                                 │
│ Filter: [Position: All ▼] [Result: All ▼]     │ Controls
│ Search: [________]  [Sort: Time ▼]            │
│                                                 │
│ Time     │ Table      │ Players │ Result│ cEV  │ Headers
│──────────┼────────────┼─────────┼───────┼──────│
│ 14:23:10 │ Table-2134 │ A, B, C │  -2.5 │ -2.5 │ Row (clickable)
│ 14:18:45 │ Table-2134 │ A, B, D │  +5.2 │ +5.2 │
│ 14:10:33 │ Table-2135 │ A, C, E │  +0.0 │ +0.0 │
│ 13:58:22 │ Table-2134 │ B, C, D │ -18.5 │-18.5 │
│ ...      │ ...        │ ...     │ ...   │ ...  │
│                                                 │
│ [< Prev] Page 1 of 5 [Next >]                 │ Pagination
│ Showing 1–50 of 342 hands                      │
└────────────────────────────────────────────────┘
```

### Features

- **Virtualized list**: 1000+ hands scroll smoothly
- **Sortable**: Time, table, result
- **Filters**:
  - Position (SB, BB, Button) — only if player tracked
  - Result (winners, losers, breakeven)
- **Search**: By table name or player
- **Pagination**: 50 hands/page (or infinite scroll w/ virtual)
- **Row click**: Open hand detail

### Columns

| Column | Example | Alignment |
|--------|---------|-----------|
| **Time** | 14:23:10 | Left |
| **Table** | Table-2134 | Left |
| **Players** | A, B, C | Left |
| **Result** | -2.5 or +5.2 | Right (color) |
| **cEV** | Same as result | Right (color) |

---

## Screen 4: Hand Detail

### Layout

```
┌──────────────────────────────────────────────────┐
│ ← Hand #1234567 (2026-06-19 14:23:10)       [≡] │
├──────────────────────────────────────────────────┤
│                                                   │
│ TABLE: Table-2134  │  STAKES: 0.50 / 1.00       │ Header
│ BUTTON: Seat 1     │  ANTE: —                    │
│                                                   │
│ ┌─ ACTION TIMELINE ─────────────────────────┐   │ Timeline
│ │ Preflop                                   │   │
│ │   PlayerA (SB): posts 0.50               │   │
│ │   PlayerB (BB): posts 1.00               │   │
│ │   PlayerC (BTN): raises to 3.00          │   │
│ │   PlayerA: calls 2.50                    │   │
│ │   PlayerB: folds                         │   │
│ │                                           │   │
│ │ Flop [2♠ 5♥ 8♦]                         │   │
│ │   PlayerA: checks                        │   │
│ │   PlayerC: bets 5.00                     │   │
│ │   PlayerA: calls 5.00                    │   │
│ │                                           │   │
│ │ Turn [2♠ 5♥ 8♦ K♣]                      │   │
│ │   PlayerA: checks                        │   │
│ │   PlayerC: checks                        │   │
│ │                                           │   │
│ │ River [2♠ 5♥ 8♦ K♣ 3♠]                  │   │
│ │   PlayerA: checks                        │   │
│ │   PlayerC: bets 8.00                     │   │
│ │   PlayerA: calls 8.00                    │   │
│ │                                           │   │
│ │ Showdown:                                 │   │
│ │   PlayerC shows: A♠ K♦ (pair of Kings)  │   │
│ │   PlayerA shows: Q♠ 9♣ (high card King) │   │
│ │   → PlayerC wins 32.50                   │   │
│ └───────────────────────────────────────────┘   │
│                                                   │
│ ┌─ LEDGER ─────────────────────────────────┐   │ Ledger
│ │ Player  │ Start │ Contrib │ Payout│ cEV │   │
│ │─────────┼───────┼─────────┼───────┼─────│   │
│ │ PlayerA │ 100   │  -16.00 │ 0     │-16.0│   │
│ │ PlayerB │ 100   │  -1.00  │ 0     │-1.0 │   │
│ │ PlayerC │ 100   │  -16.00 │ 32.50│+16.5│   │
│ │ Rake    │ —     │  —      │ 1.00 │ —   │   │
│ └───────────────────────────────────────────┘   │
│                                                   │
│ ┌─ cEV REALIZED ────────────────────────────┐   │ cEV Card
│ │ Realized cEV: outcome (stack_end - start) │   │
│ │                                            │   │
│ │ PlayerA: start 100 → end 84  → cEV -16.0 │   │
│ │ PlayerB: start 100 → end 99  → cEV -1.0  │   │
│ │ PlayerC: start 100 → end 116.5→ cEV +16.5│   │
│ │                                            │   │
│ │ Invariants:  ✓ Sum=0  ✓ Chips OK        │   │
│ └───────────────────────────────────────────┘   │
│                                                   │
│ [← Back]  [Next Hand >]                        │ Navigation
└──────────────────────────────────────────────────┘
```

### Sections

#### 1. Header (Table & Stakes)
- Table name
- Button position
- Blinds (ante, SB, BB)

#### 2. Action Timeline
- **Streets**: Preflop, Flop, Turn, River
- **Actions**: Indented under player
- **Cards shown** (if known): Boards, hole cards at showdown
- **Scrollable** if many actions

#### 3. Ledger Table
Contribution/payout accounting per player.

| Column | Example |
|--------|---------|
| Player | PlayerA |
| Start | 100 |
| Contrib | -16.00 (total bet) |
| Payout | 0 (chips won) |
| cEV | -16.0 (end - start) |

#### 4. cEV Realized Card
- **Title**: "Realized cEV: outcome (stack_end - start)"
- **Per-player breakdown**: Start → End → cEV
- **Invariant status**: ✓ or ✗

### Navigation

- **Back button**: Return to hand list
- **Next/Prev**: Jump to adjacent hands
- **Keyboard**: Arrow keys (← →) for navigation

---

## Screen 5: Error Dialog (During Import)

### Layout

```
┌──────────────────────────────────────┐
│ ⚠ Import Error                   [x] │
├──────────────────────────────────────┤
│                                       │
│ Encountered 3 parse errors.           │
│ Imported 342 / 345 hands.             │
│                                       │
│ First errors:                         │
│ • Line 142: Unknown action "xbet"    │
│ • Line 234: Player stack negative   │
│ • Line 456: Missing table name      │
│                                       │
│ [Continue] [Abort]                   │
│                                       │
│ □ Show full error log               │ (Expandable)
└──────────────────────────────────────┘
```

### Options

- **Continue**: Import partial results (342 hands)
- **Abort**: Rollback, keep nothing
- **Show full error log**: Expandable details

---

## Component Library (Reusable)

### Colors (Tailwind-inspired)

```
Primary blue: #3b82f6
Success green: #10b981
Error red: #ef4444
Warning yellow: #f59e0b
Neutral gray: #6b7280, #9ca3af, #d1d5db
```

### Typography

```
Headings: Inter Bold, 18px–24px
Body: Inter Regular, 14px–16px
Mono (actions): Courier New, 13px
```

### Icons

- ← Back
- ↓ Download
- ✓ Check / Passed
- ✗ X / Failed
- ≡ Menu (hamburger)
- ⚠ Warning
- ↑ ↓ Sort arrows

### Buttons

- **Primary**: Blue bg, white text, hover darker
- **Secondary**: Gray bg, gray text, hover lighter
- **Danger**: Red bg (for destructive actions)

---

## Responsive Layout

### Mobile (< 768px)

- Single column layout
- Drop-down filters (not side panels)
- Smaller fonts (12–14px)
- Touch-friendly tap targets (44×44px min)

### Tablet (768–1024px)

- Two-column where appropriate
- Standard layout

### Desktop (> 1024px)

- Full layout as designed

---

## Accessibility

- [ ] WCAG AA contrast (4.5:1 min)
- [ ] Keyboard navigation (Tab, Enter, Esc, Arrows)
- [ ] Screen reader labels (aria-label)
- [ ] Focus indicators (visible outline)
- [ ] Color not sole indicator (e.g., also use +/− prefix)

---

## Known Limitations (V0.1)

- No dark mode (future)
- No export/download (future)
- No player avatars or custom icons (future)
- No replay animation (future)

---

**Last updated**: 2026-06-19  
**Owner**: UI Lead
