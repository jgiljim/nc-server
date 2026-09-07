import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import NcSelect from '@nextcloud/vue/components/NcSelect'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import NcDateTimePicker from '@nextcloud/vue/components/NcDateTimePicker'
import FilterPicker from './FilterPicker.vue'
import { DOCUMENT_STATUS_VALUES, type FilterableField } from '../types'

// Component tests for FilterPicker (frontend.md § FilterPicker). NcPopover is
// stubbed so both slots render synchronously; the three-step wizard (field →
// operator → value) and the emitted `filterAdd` are exercised directly.

const NcPopoverStub = {
  name: 'NcPopover',
  props: ['shown'],
  emits: ['update:shown'],
  template: '<div class="nc-popover-stub"><slot name="trigger" :attrs="{}" /><slot /></div>',
}

const fields: FilterableField[] = [
  { field_name: 'status', display_name: 'Status', data_type: 'string', operators: ['eq'] },
  { field_name: 'reviewed', display_name: 'Reviewed', data_type: 'boolean', operators: ['eq'] },
  {
    field_name: 'total',
    display_name: 'Total',
    data_type: 'double',
    operators: ['eq', 'gt', 'lt'],
  },
  { field_name: 'vendor', display_name: 'Vendor', data_type: 'string', operators: ['eq'] },
  {
    field_name: 'amount',
    display_name: 'Amount',
    data_type: 'int64',
    operators: ['eq', 'between', 'not_between'],
  },
  { field_name: 'due_date', display_name: 'Due date', data_type: 'date', operators: ['eq'] },
  {
    field_name: 'invoice_date',
    display_name: 'Invoice date',
    data_type: 'date',
    operators: ['eq', 'between', 'not_between'],
  },
  // M125.1: a field carrying its own chosen-from list — document type, as the
  // Documents table passes it (values from GET /document-types).
  {
    field_name: 'type_name',
    display_name: 'Document type',
    data_type: 'string',
    operators: ['eq', 'not_eq', 'is_null', 'is_not_null'],
    values: [
      { value: 'commercial_invoice', label: 'Commercial invoice' },
      { value: 'delivery_note', label: 'Delivery note' },
    ],
  },
]

function mountPicker() {
  return mount(FilterPicker, {
    props: { fields },
    global: { stubs: { NcPopover: NcPopoverStub } },
  })
}

// The wizard renders NcSelects progressively: [0] field, then [1] operator,
// then (for status only) [2] value.
function selects(w: ReturnType<typeof mountPicker>) {
  return w.findAllComponents(NcSelect)
}

// @nextcloud/vue's typed prop signatures don't expose `options`/`modelValue`
// as known keys to `.props(key)`, so read them off the untyped props bag.
function propsOf(c: { props(): unknown }): Record<string, unknown> {
  return c.props() as Record<string, unknown>
}

async function pick(w: ReturnType<typeof mountPicker>, field: string, operator: string) {
  selects(w)[0].vm.$emit('update:modelValue', field)
  await w.vm.$nextTick()
  selects(w)[1].vm.$emit('update:modelValue', operator)
  await w.vm.$nextTick()
}

function confirmButton(w: ReturnType<typeof mountPicker>) {
  return w.findAllComponents(NcButton).find((b) => b.text().includes('Add filter'))!
}

describe('FilterPicker', () => {
  it('shows only the field select before a field is chosen', () => {
    const w = mountPicker()
    expect(selects(w)).toHaveLength(1)
  })

  it('reveals the operator select with the chosen field operators', async () => {
    const w = mountPicker()
    selects(w)[0].vm.$emit('update:modelValue', 'total')
    await w.vm.$nextTick()
    expect(selects(w)).toHaveLength(2)
    expect(propsOf(selects(w)[1]).options).toEqual(['eq', 'gt', 'lt'])
  })

  it('emits filterAdd with the composed constraint for a text/number field', async () => {
    const w = mountPicker()
    await pick(w, 'total', 'gt')
    w.findComponent(NcTextField).vm.$emit('update:modelValue', '100')
    await w.vm.$nextTick()
    confirmButton(w).vm.$emit('click')
    await w.vm.$nextTick()
    expect(w.emitted('filterAdd')?.[0]).toEqual([
      { field_name: 'total', operator: 'gt', value: '100' },
    ])
  })

  it('renders a status select of the five known values for the status field', async () => {
    const w = mountPicker()
    await pick(w, 'status', 'eq')
    // field + operator + value selects
    expect(selects(w)).toHaveLength(3)
    expect(propsOf(selects(w)[2]).options).toEqual([...DOCUMENT_STATUS_VALUES])
  })

  it('emits the chosen status value', async () => {
    const w = mountPicker()
    await pick(w, 'status', 'eq')
    selects(w)[2].vm.$emit('update:modelValue', 'needs_ocr')
    await w.vm.$nextTick()
    confirmButton(w).vm.$emit('click')
    await w.vm.$nextTick()
    expect(w.emitted('filterAdd')?.[0]).toEqual([
      { field_name: 'status', operator: 'eq', value: 'needs_ocr' },
    ])
  })

  it('renders a true/false toggle for the reviewed field and emits a boolean', async () => {
    const w = mountPicker()
    await pick(w, 'reviewed', 'eq')
    const toggle = w.findComponent(NcCheckboxRadioSwitch)
    expect(toggle.exists()).toBe(true)
    toggle.vm.$emit('update:modelValue', true)
    await w.vm.$nextTick()
    confirmButton(w).vm.$emit('click')
    await w.vm.$nextTick()
    expect(w.emitted('filterAdd')?.[0]).toEqual([
      { field_name: 'reviewed', operator: 'eq', value: true },
    ])
  })

  it('allows confirming a boolean filter immediately (false is meaningful)', async () => {
    const w = mountPicker()
    await pick(w, 'reviewed', 'eq')
    expect(confirmButton(w).props('disabled')).toBe(false)
    confirmButton(w).vm.$emit('click')
    await w.vm.$nextTick()
    expect(w.emitted('filterAdd')?.[0]).toEqual([
      { field_name: 'reviewed', operator: 'eq', value: false },
    ])
  })

  it('disables confirm until a text value is entered', async () => {
    const w = mountPicker()
    await pick(w, 'vendor', 'eq')
    expect(confirmButton(w).props('disabled')).toBe(true)
    w.findComponent(NcTextField).vm.$emit('update:modelValue', 'ACME')
    await w.vm.$nextTick()
    expect(confirmButton(w).props('disabled')).toBe(false)
  })

  it('does not emit on cancel and resets the wizard', async () => {
    const w = mountPicker()
    await pick(w, 'vendor', 'eq')
    const cancel = w.findAllComponents(NcButton).find((b) => b.text().includes('Cancel'))!
    cancel.vm.$emit('click')
    await w.vm.$nextTick()
    expect(w.emitted('filterAdd')).toBeUndefined()
    // wizard reset — only the field select remains
    expect(selects(w)).toHaveLength(1)
    expect(propsOf(selects(w)[0]).modelValue).toBeNull()
  })

  it('discards the in-progress filter on outside-click (update:shown false)', async () => {
    const w = mountPicker()
    await pick(w, 'vendor', 'eq')
    w.findComponent(NcPopoverStub).vm.$emit('update:shown', false)
    await w.vm.$nextTick()
    expect(w.emitted('filterAdd')).toBeUndefined()
    expect(selects(w)).toHaveLength(1)
  })

  it('renders two date pickers for a between operator on a date field', async () => {
    const w = mountPicker()
    await pick(w, 'invoice_date', 'between')
    const pickers = w.findAllComponents(NcDateTimePicker)
    expect(pickers).toHaveLength(2)
  })

  it('disables confirm until both bounds of a range are set', async () => {
    const w = mountPicker()
    await pick(w, 'invoice_date', 'between')
    expect(confirmButton(w).props('disabled')).toBe(true)
    const pickers = w.findAllComponents(NcDateTimePicker)
    pickers[0].vm.$emit('update:modelValue', new Date('2026-01-01'))
    await w.vm.$nextTick()
    expect(confirmButton(w).props('disabled')).toBe(true)
    pickers[1].vm.$emit('update:modelValue', new Date('2026-01-31'))
    await w.vm.$nextTick()
    expect(confirmButton(w).props('disabled')).toBe(false)
  })

  it('emits a combined lower,upper value for a between filter', async () => {
    const w = mountPicker()
    await pick(w, 'invoice_date', 'not_between')
    const pickers = w.findAllComponents(NcDateTimePicker)
    pickers[0].vm.$emit('update:modelValue', new Date('2026-01-01'))
    await w.vm.$nextTick()
    pickers[1].vm.$emit('update:modelValue', new Date('2026-01-31'))
    await w.vm.$nextTick()
    confirmButton(w).vm.$emit('click')
    await w.vm.$nextTick()
    expect(w.emitted('filterAdd')?.[0]).toEqual([
      { field_name: 'invoice_date', operator: 'not_between', value: '2026-01-01,2026-01-31' },
    ])
  })

  it('resets the range bounds when the operator changes away from between', async () => {
    const w = mountPicker()
    await pick(w, 'invoice_date', 'between')
    const pickers = w.findAllComponents(NcDateTimePicker)
    pickers[0].vm.$emit('update:modelValue', new Date('2026-01-01'))
    pickers[1].vm.$emit('update:modelValue', new Date('2026-01-31'))
    await w.vm.$nextTick()
    selects(w)[1].vm.$emit('update:modelValue', 'eq')
    await w.vm.$nextTick()
    expect(w.findAllComponents(NcDateTimePicker)).toHaveLength(1)
    expect(confirmButton(w).props('disabled')).toBe(true)
  })

  // api.md § Filtering allows between/not_between on int64/double as well as
  // date, so a numeric range must render two number inputs — not the
  // single-value widget (which could never satisfy confirm's both-bounds gate).
  it('renders two number inputs for a between operator on a numeric field', async () => {
    const w = mountPicker()
    await pick(w, 'amount', 'between')
    expect(w.findAllComponents(NcDateTimePicker)).toHaveLength(0)
    const inputs = w.findAllComponents(NcTextField)
    expect(inputs).toHaveLength(2)
    expect(propsOf(inputs[0]).type).toBe('number')
    expect(propsOf(inputs[1]).type).toBe('number')
  })

  it('emits a combined lower,upper value for a numeric between filter', async () => {
    const w = mountPicker()
    await pick(w, 'amount', 'between')
    expect(confirmButton(w).props('disabled')).toBe(true)
    const inputs = w.findAllComponents(NcTextField)
    inputs[0].vm.$emit('update:modelValue', '10')
    await w.vm.$nextTick()
    expect(confirmButton(w).props('disabled')).toBe(true)
    inputs[1].vm.$emit('update:modelValue', '99.5')
    await w.vm.$nextTick()
    confirmButton(w).vm.$emit('click')
    await w.vm.$nextTick()
    expect(w.emitted('filterAdd')?.[0]).toEqual([
      { field_name: 'amount', operator: 'between', value: '10,99.5' },
    ])
  })

  it('resets downstream steps when the field is changed', async () => {
    const w = mountPicker()
    await pick(w, 'total', 'gt')
    // change field to vendor — operator must clear (back to a single extra select)
    selects(w)[0].vm.$emit('update:modelValue', 'vendor')
    await w.vm.$nextTick()
    expect(propsOf(selects(w)[1]).modelValue).toBeNull()
  })

  // NcPopover only recognizes clicks inside its own DOM subtree as "inside";
  // NcSelect's dropdown defaults to teleporting into <body> (appendToBody:
  // true), which the popover's focus-trap then treats as an outside click,
  // closing the whole picker the instant a field/operator/status option is
  // picked — the filter is silently discarded before `filterAdd` can ever
  // fire (found live: the popup closed with no error on selecting a field).
  it('keeps every NcSelect dropdown inline instead of teleported to <body>', async () => {
    const w = mountPicker()
    for (const s of selects(w)) {
      expect(propsOf(s).appendToBody).toBe(false)
    }
    await pick(w, 'status', 'eq')
    for (const s of selects(w)) {
      expect(propsOf(s).appendToBody).toBe(false)
    }
  })

  // --- M125.1: chosen-from values (frontend.md § FilterPicker) --------------
  it('renders a select of the field\'s own values instead of a text input', async () => {
    const w = mountPicker()
    await pick(w, 'type_name', 'eq')

    const valueSelect = selects(w)[2]
    expect(valueSelect).toBeDefined()
    expect(propsOf(valueSelect).options).toEqual([
      { value: 'commercial_invoice', label: 'Commercial invoice' },
      { value: 'delivery_note', label: 'Delivery note' },
    ])
    // Labelled by the option's `label`, so the picker shows "Commercial
    // invoice" rather than the wire value.
    expect(propsOf(valueSelect).label).toBe('label')
  })

  it('emits the option\'s value, never its label', async () => {
    // The label is human text; only `value` is valid in an `f=` expression.
    const w = mountPicker()
    await pick(w, 'type_name', 'eq')

    selects(w)[2].vm.$emit('update:modelValue', {
      value: 'commercial_invoice',
      label: 'Commercial invoice',
    })
    await w.vm.$nextTick()
    confirmButton(w).vm.$emit('click')

    expect(w.emitted('filterAdd')?.[0]).toEqual([
      { field_name: 'type_name', operator: 'eq', value: 'commercial_invoice' },
    ])
  })

  it('clears the value when the selection is cleared', async () => {
    const w = mountPicker()
    await pick(w, 'type_name', 'eq')
    selects(w)[2].vm.$emit('update:modelValue', { value: 'delivery_note', label: 'Delivery note' })
    await w.vm.$nextTick()

    selects(w)[2].vm.$emit('update:modelValue', null)
    await w.vm.$nextTick()

    // Empty value: confirm must not offer to add a filter with no value.
    expect(propsOf(selects(w)[2]).modelValue).toBeNull()
  })

  it('leaves a field without values on its data_type widget', async () => {
    // The `values` list is opt-in; nothing else changes behaviour.
    const w = mountPicker()
    await pick(w, 'vendor', 'eq')

    expect(w.find('[data-testid="filter-picker-choice"]').exists()).toBe(false)
  })

})
