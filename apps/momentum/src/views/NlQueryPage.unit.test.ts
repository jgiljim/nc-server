import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import NlQueryPage from './NlQueryPage.vue'

// frontend.md § NL Query Page (M4.17) — a full-height IonosGPT iframe
// pre-selecting the Filo Filing agent with no document context (corpus-wide
// questions). The page is a thin host over the reusable IonosGptEmbedPanel
// (frontend.md § Iframe Embedding); the IonosGPT-side embed layout and MCP
// tools are the external IonosGPT deliverable, tracked separately.

describe('NlQueryPage', () => {
  it('mounts exactly one IonosGPT iframe', () => {
    const wrapper = mount(NlQueryPage)

    expect(wrapper.findAll('iframe')).toHaveLength(1)
  })

  it('pre-selects the Filo agent in embed mode', () => {
    const wrapper = mount(NlQueryPage)
    const src = wrapper.find('iframe').attributes('src') ?? ''
    const url = new URL(src)

    expect(url.origin).toBe('https://gpt.ionos.com')
    expect(url.pathname).toBe('/chat')
    expect(url.searchParams.get('agent')).toBe('filo')
    expect(url.searchParams.get('embed')).toBe('true')
  })

  it('passes corpus mode context — no document scoping', () => {
    const wrapper = mount(NlQueryPage)
    const src = wrapper.find('iframe').attributes('src') ?? ''
    const context = new URL(src).searchParams.get('context') ?? ''

    expect(JSON.parse(context)).toEqual({ mode: 'corpus' })
  })

  it('renders a full-height chat page wrapper', () => {
    const wrapper = mount(NlQueryPage)

    expect(wrapper.find('.momentum-page--nl-query').exists()).toBe(true)
  })
})
