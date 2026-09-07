import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import TypeaheadSearch from './TypeaheadSearch.vue'
import { MOMENTUM_CONFIG } from '../config'

// Component tests for TypeaheadSearch (frontend.md § TypeaheadSearch): a
// debounced text input that commits its term as a search pill on Enter. In v1
// there is no suggestion dropdown (commit on Enter only); the debounced query
// is the v2 suggestion-fetch seam and is asserted here for timing correctness.

function mountSearch(props: Partial<{ placeholder: string; disabled: boolean }> = {}) {
  return mount(TypeaheadSearch, {
    props: { placeholder: 'Search documents', disabled: false, ...props },
  })
}

// The commit term is whatever the field's model currently holds; drive the
// real NcTextField's model rather than the DOM input value.
function type(w: ReturnType<typeof mountSearch>, value: string) {
  w.findComponent(NcTextField).vm.$emit('update:modelValue', value)
  return w.vm.$nextTick()
}

async function pressEnter(w: ReturnType<typeof mountSearch>) {
  await w.find('input').trigger('keydown.enter')
}

describe('TypeaheadSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('passes placeholder and disabled through to NcTextField', () => {
    const w = mountSearch({ placeholder: 'Find files', disabled: true })
    const field = w.findComponent(NcTextField)
    expect(field.props('placeholder')).toBe('Find files')
    expect(field.props('disabled')).toBe(true)
  })

  it('commits the typed term on Enter and emits searchCommit', async () => {
    const w = mountSearch()
    await type(w, 'invoice')
    await pressEnter(w)
    expect(w.emitted('searchCommit')).toHaveLength(1)
    expect(w.emitted('searchCommit')?.[0]).toEqual(['invoice'])
  })

  it('clears its own input after committing', async () => {
    const w = mountSearch()
    await type(w, 'invoice')
    await pressEnter(w)
    expect(w.findComponent(NcTextField).props('modelValue')).toBe('')
  })

  it('trims surrounding whitespace from the committed term', async () => {
    const w = mountSearch()
    await type(w, '  contract  ')
    await pressEnter(w)
    expect(w.emitted('searchCommit')?.[0]).toEqual(['contract'])
  })

  it('does not commit an empty or whitespace-only term', async () => {
    const w = mountSearch()
    await type(w, '   ')
    await pressEnter(w)
    expect(w.emitted('searchCommit')).toBeUndefined()
  })

  it('does not commit while disabled', async () => {
    const w = mountSearch({ disabled: true })
    await type(w, 'invoice')
    await pressEnter(w)
    expect(w.emitted('searchCommit')).toBeUndefined()
  })

  it('emits each term separately so they coexist as distinct pills', async () => {
    const w = mountSearch()
    await type(w, 'invoice')
    await pressEnter(w)
    await type(w, 'acme')
    await pressEnter(w)
    expect(w.emitted('searchCommit')).toEqual([['invoice'], ['acme']])
  })

  it('debounces the suggestion query by SEARCH_DEBOUNCE_MS', async () => {
    const w = mountSearch()
    await type(w, 'inv')
    // Not settled before the debounce interval elapses.
    vi.advanceTimersByTime(MOMENTUM_CONFIG.SEARCH_DEBOUNCE_MS - 1)
    await w.vm.$nextTick()
    expect(w.vm.debouncedQuery).toBe('')
    // Settles once the interval passes.
    vi.advanceTimersByTime(1)
    await w.vm.$nextTick()
    expect(w.vm.debouncedQuery).toBe('inv')
  })

  it('cancels a pending debounce and resets the query on commit', async () => {
    const w = mountSearch()
    await type(w, 'invoice')
    // Commit before the debounce fires — the settled query must not later
    // reappear as a stale value.
    await pressEnter(w)
    vi.advanceTimersByTime(MOMENTUM_CONFIG.SEARCH_DEBOUNCE_MS)
    await w.vm.$nextTick()
    expect(w.vm.debouncedQuery).toBe('')
  })
})
