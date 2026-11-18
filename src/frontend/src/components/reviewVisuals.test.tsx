import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ChipAmount } from './ChipAmount'
import { HoleCards } from './PlayingCards'

describe('readable review amounts and cards', () => {
  it('switches the primary stack unit and retains its exact chip/BB counterpart', () => {
    const bb = renderToStaticMarkup(<ChipAmount value={500} bigBlind={20} unit="bb" />)
    expect(bb).toContain('<strong>25 BB</strong>')
    expect(bb).toContain('<small>500 jetons</small>')
    const chips = renderToStaticMarkup(<ChipAmount value={500} bigBlind={20} unit="chips" />)
    expect(chips).toContain('<strong>500 jetons</strong>')
    expect(chips).toContain('<small>25 BB</small>')
    expect(renderToStaticMarkup(<ChipAmount value={0} bigBlind={20} unit="bb" />)).toContain('<strong>0 BB</strong>')
    const missing = renderToStaticMarkup(<ChipAmount value={500} bigBlind={0} unit="bb" />)
    expect(missing).toContain('<strong>- BB</strong>')
    expect(missing).toContain('<small>500 jetons</small>')
    expect(missing).not.toContain('Infinity')
  })

  it('renders both hole cards with ranks/suits and distinguishes hidden and invalid data', () => {
    const known = renderToStaticMarkup(<HoleCards cards="Th As" />)
    expect(known).toContain('10 de coeur')
    expect(known).toContain('A de pique')
    expect(known).toContain('♥')
    expect(known).toContain('♠')
    expect(renderToStaticMarkup(<HoleCards cards={null} />).match(/Carte masquee/g)).toHaveLength(2)
    expect(renderToStaticMarkup(<HoleCards cards="bad As" />)).toContain('Carte non reconnue : bad')
    expect(renderToStaticMarkup(<HoleCards cards="As" />)).toContain('Cartes non reconnues')
  })
})
