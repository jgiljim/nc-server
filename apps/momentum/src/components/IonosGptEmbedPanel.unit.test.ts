import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import IonosGptEmbedPanel from './IonosGptEmbedPanel.vue'
import { GPT_ORIGIN } from '../embed/ionosGptEmbed'

// frontend.md § AI Chat Integration — the Vue-side host of the reusable
// embed primitive, used by Vue-routed pages (e.g. the NL Query Page, M4.17).

describe('IonosGptEmbedPanel', () => {
  it('mounts exactly one iframe on mount', () => {
    const wrapper = mount(IonosGptEmbedPanel, {
      props: { context: { mode: 'document', doc_id: '1' } },
    })

    expect(wrapper.findAll('iframe')).toHaveLength(1)
  })

  it('re-injects context via postMessage when the context prop changes', async () => {
    const wrapper = mount(IonosGptEmbedPanel, {
      props: { context: { mode: 'document', doc_id: '1' } },
    })
    const iframe = wrapper.find('iframe').element
    const postMessage = vi.fn()
    Object.defineProperty(iframe, 'contentWindow', {
      value: { postMessage },
      configurable: true,
    })

    await wrapper.setProps({ context: { mode: 'document', doc_id: '2' } })

    expect(postMessage).toHaveBeenCalledWith(
      { type: 'momentum:context', payload: { mode: 'document', doc_id: '2' } },
      GPT_ORIGIN,
    )
  })

  it('destroys the iframe on unmount', () => {
    const wrapper = mount(IonosGptEmbedPanel, {
      props: { context: { mode: 'corpus' } },
    })

    wrapper.unmount()

    expect(document.querySelectorAll('iframe')).toHaveLength(0)
  })
})
