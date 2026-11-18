import { renderToStaticMarkup } from 'react-dom/server'
import type { Dispatch, SetStateAction } from 'react'
import { describe, expect, it } from 'vitest'
import { createReviewState } from './reviewState'

describe('review choices across navigation', () => {
  it('restores filters on remount and keeps each tournament scope independent', () => {
    const useFilters = createReviewState(() => ({ query: '', unit: 'chips' }))
    let update: Dispatch<SetStateAction<{ query: string; unit: string }>> = () => { throw new Error('Not mounted') }
    function Page({ id }: { readonly id: string }) {
      const [filters, setFilters] = useFilters(id)
      update = setFilters
      return <span>{filters.query}/{filters.unit}</span>
    }
    expect(renderToStaticMarkup(<Page id="T1" />)).toContain('/chips')
    update({ query: 'AA', unit: 'bb' })
    expect(renderToStaticMarkup(<Page id="T2" />)).toContain('/chips')
    update({ query: 'KQ', unit: 'chips' })
    expect(renderToStaticMarkup(<Page id="T1" />)).toContain('AA/bb')
    expect(renderToStaticMarkup(<Page id="T2" />)).toContain('KQ/chips')
  })

  it('applies functional multiselections to the latest value and supports resetting them', () => {
    const useSelection = createReviewState(() => new Set<string>())
    let update: Dispatch<SetStateAction<Set<string>>> = () => { throw new Error('Not mounted') }
    function Page() {
      const [selection, setSelection] = useSelection()
      update = setSelection
      return <span>{[...selection].join(',')}</span>
    }
    renderToStaticMarkup(<Page />)
    update((previous) => new Set([...previous, 'KJs']))
    update((previous) => new Set([...previous, 'KQo']))
    expect(renderToStaticMarkup(<Page />)).toContain('KJs,KQo')
    update(new Set())
    expect(renderToStaticMarkup(<Page />)).toBe('<span></span>')
  })
})
