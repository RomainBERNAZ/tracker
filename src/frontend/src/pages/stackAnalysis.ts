import type { StackChipTotals, StackStatsGroup } from '../api'

export const STACK_BUCKETS = ['0-8 BB', '>8-12 BB', '>12-20 BB', '>20 BB'] as const
export type StackFormat = 'all' | '2' | '3'

export function toggleStackBucket(buckets: readonly number[], bucket: number) {
  return buckets.includes(bucket) ? buckets.filter((value) => value !== bucket) : [...buckets, bucket]
}

function emptyChips(): StackChipTotals {
  return { net: 0, ev: 0, sd: 0, sd_ev: 0, wsd: 0, wsd_ev: 0 }
}

function emptyRow(bucket: number) {
  return {
    bucket, hands: 0, preflopHands: 0, missingEvHands: 0, missingPreflopHands: 0,
    vpip: 0, pfr: 0, limp: 0, threeBet: 0, threeBetOpportunities: 0,
    foldToThreeBet: 0, foldToThreeBetOpportunities: 0,
    chips: emptyChips(), bb: emptyChips(),
  }
}

export type StackAnalysisRow = ReturnType<typeof emptyRow>

function addChips(target: StackChipTotals, source: StackChipTotals) {
  target.net += source.net
  target.ev += source.ev
  target.sd += source.sd
  target.sd_ev += source.sd_ev
  target.wsd += source.wsd
  target.wsd_ev += source.wsd_ev
}

function addRow(target: StackAnalysisRow, source: StackAnalysisRow) {
  target.hands += source.hands
  target.preflopHands += source.preflopHands
  target.missingEvHands += source.missingEvHands
  target.missingPreflopHands += source.missingPreflopHands
  target.vpip += source.vpip
  target.pfr += source.pfr
  target.limp += source.limp
  target.threeBet += source.threeBet
  target.threeBetOpportunities += source.threeBetOpportunities
  target.foldToThreeBet += source.foldToThreeBet
  target.foldToThreeBetOpportunities += source.foldToThreeBetOpportunities
  addChips(target.chips, source.chips)
  addChips(target.bb, source.bb)
}

export function analyzeStacks(groups: readonly StackStatsGroup[], format: StackFormat, buckets: readonly number[]) {
  const rows = STACK_BUCKETS.map((_, bucket) => emptyRow(bucket))
  for (const group of groups) {
    if (format !== 'all' && group.player_count !== Number(format)) continue
    const stats = group.preflop
    addRow(rows[group.bucket], {
      bucket: group.bucket, hands: group.hands, preflopHands: stats.hands,
      missingEvHands: group.missing_ev_hands, missingPreflopHands: group.missing_preflop_hands,
      vpip: stats.vpip_count, pfr: stats.pfr_count, limp: stats.limp_count,
      threeBet: stats.three_bet_count, threeBetOpportunities: stats.three_bet_opportunities,
      foldToThreeBet: stats.fold_to_three_bet_count, foldToThreeBetOpportunities: stats.fold_to_three_bet_opportunities,
      chips: group.chips, bb: group.bb,
    })
  }
  const selected = rows.filter((row) => buckets.length === 0 || buckets.includes(row.bucket))
  const total = emptyRow(-1)
  selected.forEach((row) => addRow(total, row))
  return { rows: selected, total }
}

export function stackRates(row: StackAnalysisRow, tournamentCount: number, unit: 'chips' | 'bb') {
  return {
    cevPerTournament: tournamentCount > 0 && row.hands > 0 ? row.chips.ev / tournamentCount : null,
    netPer100: row.hands > 0 ? row[unit].net * 100 / row.hands : null,
    evPer100: row.hands > 0 ? row[unit].ev * 100 / row.hands : null,
  }
}

interface StackFinding {
  id: 'tight-hu' | 'fold-three-bet' | 'continue-three-bet'
  title: string
  evidence: string
  action: string
}

export interface StackDiagnostic {
  playerCount: 2 | 3
  row: StackAnalysisRow
  outcome: 'limited' | 'incomplete' | 'negative-ev' | 'below-ev' | 'no-signal'
  findings: StackFinding[]
  focus: string
}

const EXPRESSO_REVIEW_FOCUS = {
  2: [
    'Revois les decisions SB contre BB : push/fold, calls face aux tapis et limp/shove. A cette profondeur, distingue les mains ou les blindes te mettent deja a tapis.',
    'Revois le choix limp / minraise / shove en SB, puis les defenses de BB face a chacun de ces sizings.',
    'Revois les pots limpes SB contre BB, les minraises et les reponses aux reshoves. Separe les calls de tapis des pots joues postflop.',
    'Revois les pots limpes et relances SB contre BB, puis les gros pots postflop hors position. Ne transpose pas une strategie push/fold a ces profondeurs.',
  ],
  3: [
    'Separe les shoves du bouton, les duels SB contre BB apres un fold du bouton et les calls de tapis avec un troisieme joueur encore en jeu.',
    'Revois les opens du bouton et les reshoves depuis les blindes. Un call de tapis avec un joueur derriere ne se traite pas comme un duel SB contre BB.',
    'Separe les opens du bouton, les completes de SB apres fold du bouton et les defenses de BB. Revois les pots multiway a part.',
    'Revois les pots relances du bouton et les defenses hors position dans les blindes, puis les gros pots postflop. Distingue heads-up et multiway dans la main.',
  ],
} as const

export function stackDiagnostics(groups: readonly StackStatsGroup[], format: StackFormat, buckets: readonly number[]) {
  const formats: readonly ('2' | '3')[] = format === 'all' ? ['2', '3'] : [format]
  const diagnostics = formats.flatMap((selectedFormat) =>
    analyzeStacks(groups, selectedFormat, buckets).rows
      .filter((row) => row.hands > 0)
      .map((row): StackDiagnostic => {
        const playerCount = selectedFormat === '2' ? 2 : 3
        const findings: StackFinding[] = []
        const outcome = row.hands < 200 ? 'limited' : row.missingEvHands > 0 ? 'incomplete' :
          row.bb.ev < 0 || row.chips.ev < 0 ? 'negative-ev' :
            row.bb.net < 0 || row.chips.net < 0 ? 'below-ev' : 'no-signal'

        if (row.hands >= 200 && row.preflopHands >= 200) {
          const vpip = row.vpip * 100 / row.preflopHands
          if (playerCount === 2 && row.bucket > 0 && vpip < 40) {
            findings.push({
              id: 'tight-hu',
              title: 'Peu de pots joues volontairement en heads-up',
              evidence: `VPIP ${vpip.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} % : ${row.vpip} / ${row.preflopHands} mains.`,
              action: 'Piste de jeu trop serre : revois separement tes entrees en SB et tes defenses de BB. Verifie les sizings adverses avant d\'elargir ; les checks de BB ne comptent pas dans le VPIP.',
            })
          }
          if (row.foldToThreeBetOpportunities >= 30) {
            const fold = row.foldToThreeBet * 100 / row.foldToThreeBetOpportunities
            const evidence = `${row.foldToThreeBet} folds / ${row.foldToThreeBetOpportunities} decisions face au 3-bet (${fold.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %).`
            if (fold >= 80) {
              findings.push({
                id: 'fold-three-bet',
                title: 'Tes opens sont souvent abandonnes face aux 3-bets',
                evidence,
                action: row.bucket <= 1
                  ? 'Revois tes minraise/folds face aux reshoves : range d\'open, taille de relance et prix du call. Compare limp, petit open et shove selon le stack effectif, sans te forcer a payer plus.'
                  : 'Revois les opens suivis d\'un fold : position, taille du 3-bet et profil adverse. Cherche les opens trop larges ou les defenses abandonnees, pas un taux de call a atteindre.',
              })
            } else if (fold <= 20 && row.bucket >= 2) {
              findings.push({
                id: 'continue-three-bet',
                title: 'Tu continues presque toujours face aux 3-bets',
                evidence,
                action: 'Revois tes calls et 4-bets, surtout hors position : range adverse, cote du pot et stack effectif. Un faible taux de fold ne prouve pas a lui seul une surdefense.',
              })
            }
          }
        }
        return { playerCount, row, outcome, findings, focus: EXPRESSO_REVIEW_FOCUS[playerCount][row.bucket] }
      }),
  )
  const priority = (diagnostic: StackDiagnostic) => diagnostic.outcome === 'limited' ? 5 :
    diagnostic.findings.length > 0 ? 0 : diagnostic.outcome === 'negative-ev' ? 1 :
      diagnostic.outcome === 'below-ev' ? 2 : diagnostic.outcome === 'incomplete' ? 3 : 4
  return diagnostics.sort((a, b) => priority(a) - priority(b) || a.row.chips.ev - b.row.chips.ev)
}
