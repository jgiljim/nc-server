import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import ColumnPicker from './ColumnPicker.vue'
import type { ColumnDef } from '../types'

// Component tests for ColumnPicker (frontend.md § ColumnPicker). NcPopover is
// stubbed so its trigger + default slots render synchronously — the popover
// chrome is @nextcloud/vue's concern; these tests exercise this component's
// own contract: a checklist reflecting `selected`, emitting `change`.

const NcPopoverStub = {
  name: 'NcPopover',
  template: '<div class="nc-popover-stub"><slot name="trigger" :attrs="{}" /><slot /></div>',
}

const columns: ColumnDef[] = [
  { key: 'name', label: 'Name' },
  { key: 'status', label: 'Status' },
  { key: 'total', label: 'Total' },
]

function mountPicker(selected: string[]) {
  return mount(ColumnPicker, {
    props: { columns, selected },
    global: { stubs: { NcPopover: NcPopoverStub } },
  })
}

describe('ColumnPicker', () => {
  it('renders one toggle per column, labelled by ColumnDef.label', () => {
    const w = mountPicker(['name'])
    const switches = w.findAllComponents(NcCheckboxRadioSwitch)
    expect(switches).toHaveLength(3)
    expect(switches.map((s) => s.text())).toEqual(['Name', 'Status', 'Total'])
  })

  it('reflects the selected set as the checked state of each toggle', () => {
    const w = mountPicker(['name', 'total'])
    const checked = w
      .findAllComponents(NcCheckboxRadioSwitch)
      .map((s) => s.props('modelValue'))
    expect(checked).toEqual([true, false, true])
  })

  it('emits change adding a column when a hidden one is toggled on', async () => {
    const w = mountPicker(['name'])
    // 'status' is the second column
    w.findAllComponents(NcCheckboxRadioSwitch)[1].vm.$emit('update:modelValue', true)
    await w.vm.$nextTick()
    expect(w.emitted('change')?.[0]).toEqual([['name', 'status']])
  })

  it('emits change removing a column when a visible one is toggled off', async () => {
    const w = mountPicker(['name', 'status', 'total'])
    w.findAllComponents(NcCheckboxRadioSwitch)[1].vm.$emit('update:modelValue', false)
    await w.vm.$nextTick()
    expect(w.emitted('change')?.[0]).toEqual([['name', 'total']])
  })

  it('preserves column order in the emitted set regardless of toggle order', async () => {
    // Only 'total' visible; toggle 'name' (first column) on — it must land first.
    const w = mountPicker(['total'])
    w.findAllComponents(NcCheckboxRadioSwitch)[0].vm.$emit('update:modelValue', true)
    await w.vm.$nextTick()
    expect(w.emitted('change')?.[0]).toEqual([['name', 'total']])
  })
})
