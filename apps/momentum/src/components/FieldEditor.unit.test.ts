import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import FieldEditor from './FieldEditor.vue'
import * as documentsService from '../services/documents'

// frontend.md § FieldEditor — renders the field list for a document, tracks
// dirty state against the fetched originals, and issues the save/review API
// calls (Save Changes auto-marks reviewed; Mark Reviewed/Unreviewed toggles
// independently).

vi.mock('../services/documents')

const SCHEMA = {
  type_name: 'invoice',
  display_name: 'Invoice',
  fields: [
    { field_name: 'vendor_name', display_name: 'Vendor', data_type: 'string', sort_order: 2 },
    { field_name: 'is_paid', display_name: 'Paid', data_type: 'boolean', sort_order: 1 },
    { field_name: 'total_amount', display_name: 'Total', data_type: 'double', sort_order: 3 },
    { field_name: 'due_date', display_name: 'Due date', data_type: 'date', sort_order: 4 },
    { field_name: 'line_count', display_name: 'Lines', data_type: 'int64', sort_order: 5 },
    {
      field_name: 'document_general_summary',
      display_name: 'Document General Summary',
      data_type: 'string',
      sort_order: 6,
    },
  ],
}

const DOCUMENT = {
  id: 1,
  doc_type: 'invoice',
  status: 'done',
  reviewed: false,
  fields: {
    vendor_name: 'Acme',
    is_paid: false,
    total_amount: 12.5,
    due_date: '2026-08-01',
    line_count: 3,
    document_general_summary: 'This is an invoice from Acme for consulting services, due August 1st.',
  },
}

async function mountEditor() {
  const wrapper = mount(FieldEditor, { props: { docId: '1', docType: 'invoice' } })
  await flushPromises()
  return wrapper
}

describe('FieldEditor', () => {
  beforeEach(() => {
    vi.mocked(documentsService.fetchDocumentTypeSchema).mockResolvedValue(SCHEMA as never)
    vi.mocked(documentsService.fetchDocument).mockResolvedValue(DOCUMENT as never)
    vi.mocked(documentsService.patchDocumentFields).mockResolvedValue({
      fields: { ...DOCUMENT.fields, vendor_name: 'Acme Corp' },
      reviewed: true,
    } as never)
    vi.mocked(documentsService.patchDocument).mockResolvedValue(undefined)
  })

  it('shows a loading state until both the schema and the document resolve', () => {
    const wrapper = mount(FieldEditor, { props: { docId: '1', docType: 'invoice' } })

    expect(wrapper.text()).not.toContain('Vendor')
  })

  it('renders fields in sort_order sequence, pre-populated with fetched values', async () => {
    const wrapper = await mountEditor()

    const labels = wrapper.findAll('[data-field-name]').map((f) => f.attributes('data-field-name'))
    expect(labels).toEqual(['is_paid', 'vendor_name', 'total_amount', 'due_date', 'line_count'])
  })

  it('renders a visible outside label for text/number fields instead of relying on NcTextField\'s internal label', async () => {
    const wrapper = await mountEditor()

    const vendorField = wrapper.get('[data-field-name="vendor_name"]')
    const label = vendorField.get('.momentum-field-editor__field-label')
    expect(label.text()).toBe('Vendor')
    const textField = vendorField.getComponent({ name: 'NcTextField' })
    expect(textField.props('labelOutside')).toBe(true)

    const totalField = wrapper.get('[data-field-name="total_amount"]')
    expect(totalField.get('.momentum-field-editor__field-label').text()).toBe('Total')

    const lineCountField = wrapper.get('[data-field-name="line_count"]')
    expect(lineCountField.get('.momentum-field-editor__field-label').text()).toBe('Lines')
  })

  it('shows the document type\'s display name and field count above the field list', async () => {
    const wrapper = await mountEditor()

    const summary = wrapper.get('[data-testid="type-summary"]')
    expect(summary.get('[data-testid="type-summary-label"]').text()).toBe('Invoice')
    expect(summary.get('[data-testid="type-summary-count"]').text()).toBe('5 fields')
  })

  it('collapses the field list under a "Document information" disclosure, closed by default', async () => {
    const wrapper = await mountEditor()

    const disclosure = wrapper.get('[data-testid="document-info-disclosure"]')
    expect(disclosure.element.hasAttribute('open')).toBe(false)
    expect(disclosure.get('[data-testid="document-info-summary"]').text()).toContain('Document information')

    await disclosure.get('[data-testid="document-info-summary"]').trigger('click')

    expect(disclosure.element.hasAttribute('open')).toBe(true)
    expect(wrapper.text()).toContain(
      'You can correct any value here. Changes update the document manager’s data only. The original file in HiDrive Next stays unchanged.',
    )
  })

  it('scrolls the field list independently when it is too long to fit', async () => {
    const wrapper = await mountEditor()

    const scroller = wrapper.get('[data-testid="fields-scroll"]')
    expect(scroller.classes()).toContain('momentum-field-editor__fields-scroll')
    expect(scroller.findAll('[data-field-name]').length).toBe(5)
  })

  it('clips a date field to its own width so a fractional NcDateTimePicker width cannot register as horizontal overflow on the shared fields-scroll region (M174.6)', async () => {
    const wrapper = await mountEditor()

    const dateField = wrapper.get('[data-field-name="due_date"] .momentum-field-editor__date-field')
    expect(getComputedStyle(dateField.element).overflowX).toBe('hidden')
  })

  it("shows document_general_summary as an AI-summary callout, not as an editable field row or in the field count", async () => {
    const wrapper = await mountEditor()

    const summary = wrapper.get('[data-testid="document-summary"]')
    expect(summary.text()).toBe(
      'This is an invoice from Acme for consulting services, due August 1st.',
    )
    expect(wrapper.find('[data-field-name="document_general_summary"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="type-summary-count"]').text()).toBe('5 fields')
  })

  it('renders no summary callout when the document has no document_general_summary value', async () => {
    vi.mocked(documentsService.fetchDocument).mockResolvedValue({
      ...DOCUMENT,
      fields: { ...DOCUMENT.fields, document_general_summary: undefined },
    } as never)

    const wrapper = await mountEditor()

    expect(wrapper.find('[data-testid="document-summary"]').exists()).toBe(false)
  })

  it('disables Save Changes until a field becomes dirty, then saves only the dirty fields', async () => {
    const wrapper = await mountEditor()

    const saveButton = wrapper.get('[data-testid="save-changes"]')
    expect(saveButton.attributes('disabled')).toBeDefined()

    const vendorInput = wrapper.get('[data-field-name="vendor_name"] input')
    await vendorInput.setValue('Acme Corp')
    await flushPromises()

    expect(wrapper.get('[data-testid="save-changes"]').attributes('disabled')).toBeUndefined()
    expect(wrapper.get('[data-field-name="vendor_name"]').classes()).toContain(
      'momentum-field-editor__field--dirty',
    )

    await wrapper.get('[data-testid="save-changes"]').trigger('click')
    await flushPromises()

    expect(documentsService.patchDocumentFields).toHaveBeenCalledWith('1', { vendor_name: 'Acme Corp' })
    expect(wrapper.get('[data-testid="save-changes"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-field-name="vendor_name"]').classes()).not.toContain(
      'momentum-field-editor__field--dirty',
    )
  })

  it('emits dirty state as fields change, including on mount', async () => {
    const wrapper = await mountEditor()

    expect(wrapper.emitted('update:dirty')?.at(-1)).toEqual([false])

    const vendorInput = wrapper.get('[data-field-name="vendor_name"] input')
    await vendorInput.setValue('Acme Corp')
    await flushPromises()

    expect(wrapper.emitted('update:dirty')?.at(-1)).toEqual([true])
  })

  it('discards unsaved edits back to the last fetched values with no request', async () => {
    const wrapper = await mountEditor()
    vi.mocked(documentsService.patchDocumentFields).mockClear()

    expect(wrapper.find('[data-testid="discard-changes"]').exists()).toBe(false)

    const vendorInput = wrapper.get('[data-field-name="vendor_name"] input')
    await vendorInput.setValue('Acme Corp')
    await flushPromises()

    expect(wrapper.find('[data-testid="discard-changes"]').exists()).toBe(true)

    await wrapper.get('[data-testid="discard-changes"]').trigger('click')
    await flushPromises()

    expect((wrapper.get('[data-field-name="vendor_name"] input').element as HTMLInputElement).value).toBe(
      'Acme',
    )
    expect(wrapper.find('[data-testid="discard-changes"]').exists()).toBe(false)
    expect(documentsService.patchDocumentFields).not.toHaveBeenCalled()
  })

  it('toggles Mark Reviewed / Mark Unreviewed and calls the flags PATCH', async () => {
    const wrapper = await mountEditor()

    const reviewButton = wrapper.get('[data-testid="toggle-reviewed"]')
    expect(reviewButton.text()).toContain('Mark Reviewed')

    await reviewButton.trigger('click')
    await flushPromises()

    expect(documentsService.patchDocument).toHaveBeenCalledWith('1', { reviewed: true })
    expect(wrapper.get('[data-testid="toggle-reviewed"]').text()).toContain('Mark Unreviewed')
  })

  // M139.1 — DocumentViewerPage's top-bar "Reviewed" pill mirrors this
  // component's own reviewed state rather than a second independent read.
  it('emits reviewed state as it changes, including on mount', async () => {
    const wrapper = await mountEditor()

    expect(wrapper.emitted('update:reviewed')?.at(-1)).toEqual([false])

    await wrapper.get('[data-testid="toggle-reviewed"]').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('update:reviewed')?.at(-1)).toEqual([true])
  })

  // Phase 174 / M174.3: the footer's three action buttons (Save Changes /
  // Discard changes / Mark Reviewed) defaulted to `display: block`, so they
  // stacked and left-aligned instead of flowing in a row anchored to the
  // bottom-right of the column, as `#doc-fields-footer` in the mockup does.
  // Only the re-flow is in scope — not matching the mockup's own two-button,
  // sentence-case arrangement (see backlog Phase 174's M174.3 note), so this
  // asserts our intended flow and casing convention, not the mockup's exact
  // values.
  describe('document viewer actions row (Phase 174 / M174.3)', () => {
    it('flows the three action buttons in a row anchored to the end, not stacked and left-aligned', async () => {
      const wrapper = await mountEditor()
      const footer = wrapper.get('footer.momentum-document-viewer__actions').element
      const style = getComputedStyle(footer)

      expect(style.display).toBe('flex')
      expect(style.justifyContent).toBe('flex-end')
      expect(style.alignItems).toBe('center')
      // Anchors the footer to the bottom of its `flex-direction: column`
      // parent (DocumentViewerPage.vue's `.momentum-document-viewer__editor`)
      // instead of floating mid-panel.
      expect(style.marginTop).toBe('auto')
    })

    it('renders the three buttons in Save Changes / Discard changes / Mark Reviewed order once dirty', async () => {
      const wrapper = await mountEditor()

      const vendorInput = wrapper.get('[data-field-name="vendor_name"] input')
      await vendorInput.setValue('Acme Corp')
      await flushPromises()

      const testIds = wrapper
        .findAll('.momentum-document-viewer__actions [data-testid]')
        .map((el) => el.attributes('data-testid'))

      expect(testIds).toEqual(['save-changes', 'discard-changes', 'toggle-reviewed'])
    })

    it('uses the same casing convention (title case) for all three labels', async () => {
      const wrapper = await mountEditor()

      const vendorInput = wrapper.get('[data-field-name="vendor_name"] input')
      await vendorInput.setValue('Acme Corp')
      await flushPromises()

      const isTitleCase = (label: string): boolean =>
        label
          .split(' ')
          .every((word) => word.length > 0 && word[0] === word[0].toUpperCase())

      const saveLabel = wrapper.get('[data-testid="save-changes"]').text()
      const discardLabel = wrapper.get('[data-testid="discard-changes"]').text()
      const reviewLabel = wrapper.get('[data-testid="toggle-reviewed"]').text()

      expect(isTitleCase(saveLabel)).toBe(true)
      expect(isTitleCase(discardLabel)).toBe(true)
      expect(isTitleCase(reviewLabel)).toBe(true)
    })
  })

  describe('needs_ocr status', () => {
    beforeEach(() => {
      vi.mocked(documentsService.fetchDocument).mockResolvedValue({
        ...DOCUMENT,
        status: 'needs_ocr',
      } as never)
    })

    it('shows an explanatory message with an empty field list and no save/review controls', async () => {
      const wrapper = await mountEditor()

      expect(wrapper.find('[data-testid="needs-ocr-message"]').exists()).toBe(true)
      expect(wrapper.findAll('[data-field-name]')).toHaveLength(0)
      expect(wrapper.find('[data-testid="save-changes"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="toggle-reviewed"]').exists()).toBe(false)
    })
  })

  // M158.1 — doc_type is legitimately null/empty for any document that
  // never reached the classify pipeline step (needs_ocr is the reliable
  // repro; see architecture.md § pipeline step 4). load() must still learn
  // the document's status in that case instead of bailing out before
  // loading.value is ever reset to false.
  describe('needs_ocr status with no docType (M158.1)', () => {
    beforeEach(() => {
      vi.mocked(documentsService.fetchDocument).mockResolvedValue({
        ...DOCUMENT,
        doc_type: null,
        status: 'needs_ocr',
      } as never)
      vi.mocked(documentsService.fetchDocumentTypeSchema).mockClear()
    })

    it('shows the needs-ocr message instead of spinning forever, with no save/review controls', async () => {
      const wrapper = mount(FieldEditor, { props: { docId: '1', docType: '' } })
      await flushPromises()

      expect(wrapper.find('[data-testid="needs-ocr-message"]').exists()).toBe(true)
      expect(wrapper.find('.momentum-field-editor__skeleton[aria-busy="true"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="save-changes"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="discard-changes"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="toggle-reviewed"]').exists()).toBe(false)
      expect(documentsService.fetchDocumentTypeSchema).not.toHaveBeenCalled()
    })
  })

  describe('failed status', () => {
    beforeEach(() => {
      vi.mocked(documentsService.fetchDocument).mockResolvedValue({
        ...DOCUMENT,
        status: 'failed',
      } as never)
      vi.mocked(documentsService.reprocessDocument).mockResolvedValue(undefined)
    })

    it('shows an error state with no save/review controls and offers a Reprocess action', async () => {
      const wrapper = await mountEditor()

      expect(wrapper.find('[data-testid="failed-message"]').exists()).toBe(true)
      expect(wrapper.findAll('[data-field-name]')).toHaveLength(0)
      expect(wrapper.find('[data-testid="save-changes"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="toggle-reviewed"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="reprocess"]').exists()).toBe(true)
    })

    it('reprocesses the document and re-fetches its status on click', async () => {
      const wrapper = await mountEditor()

      vi.mocked(documentsService.fetchDocument).mockResolvedValue({
        ...DOCUMENT,
        status: 'processing',
      } as never)

      await wrapper.get('[data-testid="reprocess"]').trigger('click')
      await flushPromises()

      expect(documentsService.reprocessDocument).toHaveBeenCalledWith('1')
      expect(wrapper.find('[data-testid="failed-message"]').exists()).toBe(false)
    })
  })

  describe('pending/processing status (M68.4)', () => {
    it('shows a loading state over the field list instead of the stale values, with no save/discard/review controls', async () => {
      vi.mocked(documentsService.fetchDocument).mockResolvedValue({
        ...DOCUMENT,
        status: 'processing',
      } as never)

      const wrapper = await mountEditor()

      expect(wrapper.find('[data-testid="reprocessing-message"]').exists()).toBe(true)
      expect(wrapper.findAll('[data-field-name]')).toHaveLength(0)
      expect(wrapper.find('[data-testid="save-changes"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="discard-changes"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="toggle-reviewed"]').exists()).toBe(false)
    })
  })

  // M129.2 (frontend.md § Special status states) — a re-run that never
  // completes used to leave this panel on its "Reprocessing this document…"
  // skeleton for ever. DocumentViewerPage owns the wait (it owns the poll),
  // so it tells this component when the wait has run out; this component owns
  // what the user is told and offers the way out.
  describe('a reprocess that never finishes (M129.2)', () => {
    beforeEach(() => {
      vi.mocked(documentsService.fetchDocument).mockResolvedValue({
        ...DOCUMENT,
        status: 'pending',
      } as never)
    })

    it('replaces the indefinite skeleton with a terminal stalled state offering a way out', async () => {
      const wrapper = mount(FieldEditor, {
        props: { docId: '1', docType: 'invoice', processingStalled: true },
      })
      await flushPromises()

      expect(wrapper.find('[data-testid="processing-stalled-message"]').exists()).toBe(true)
      // The indefinite spinner is exactly what this state replaces — showing
      // both would leave the "still working on it" reading in place.
      expect(wrapper.find('[data-testid="reprocessing-message"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="recheck"]').exists()).toBe(true)
      // Still not an editable field body: the fields on the server are the
      // *previous* run's, and the re-run may yet land.
      expect(wrapper.findAll('[data-field-name]')).toHaveLength(0)
      expect(wrapper.find('[data-testid="save-changes"]').exists()).toBe(false)
    })

    it('asks the parent to resume the wait when the user rechecks', async () => {
      const wrapper = mount(FieldEditor, {
        props: { docId: '1', docType: 'invoice', processingStalled: true },
      })
      await flushPromises()

      await wrapper.get('[data-testid="recheck"]').trigger('click')

      expect(wrapper.emitted('recheck')).toHaveLength(1)
    })

    it('ignores a stalled wait once the document is no longer processing', async () => {
      vi.mocked(documentsService.fetchDocument).mockResolvedValue({
        ...DOCUMENT,
        status: 'done',
      } as never)

      const wrapper = mount(FieldEditor, {
        props: { docId: '1', docType: 'invoice', processingStalled: true },
      })
      await flushPromises()

      expect(wrapper.find('[data-testid="processing-stalled-message"]').exists()).toBe(false)
      expect(wrapper.findAll('[data-field-name]').length).toBeGreaterThan(0)
    })
  })

  describe('line_items field (specs/document-types/line-items.md)', () => {
    const LINE_ITEMS_SCHEMA = {
      type_name: 'commercial_invoice',
      display_name: 'Commercial Invoice',
      fields: [
        { field_name: 'vendor_name', display_name: 'Vendor', data_type: 'string', sort_order: 0 },
        { field_name: 'line_items', display_name: 'Line Items', data_type: 'string', sort_order: 1 },
      ],
    }
    const LINE_ITEMS_JSON = JSON.stringify([
      { description: 'Widget', quantity: 2, unit_price: 9.5 },
      { description: 'Gadget', quantity: 1, unit_price: 20 },
    ])

    beforeEach(() => {
      vi.mocked(documentsService.fetchDocumentTypeSchema).mockResolvedValue(LINE_ITEMS_SCHEMA as never)
      vi.mocked(documentsService.fetchDocument).mockResolvedValue({
        ...DOCUMENT,
        doc_type: 'commercial_invoice',
        fields: { vendor_name: 'Acme', line_items: LINE_ITEMS_JSON },
      } as never)
    })

    it('renders a JSON array line_items value as a table instead of a text input', async () => {
      const wrapper = await mountEditor()

      const field = wrapper.get('[data-field-name="line_items"]')
      expect(field.find('input').exists()).toBe(false)

      const table = field.get('[data-testid="line-items-table"]')
      const headers = table.findAll('th').map((h) => h.text())
      expect(headers).toEqual(['Description', 'Quantity', 'Unit Price'])

      const rows = table.findAll('tbody tr')
      expect(rows).toHaveLength(2)
      expect(rows[0].findAll('td').map((c) => c.text())).toEqual(['Widget', '2', '9.5'])
      expect(rows[1].findAll('td').map((c) => c.text())).toEqual(['Gadget', '1', '20'])
    })

    it('falls back to a plain text field when line_items is not valid JSON', async () => {
      vi.mocked(documentsService.fetchDocument).mockResolvedValue({
        ...DOCUMENT,
        doc_type: 'commercial_invoice',
        fields: { vendor_name: 'Acme', line_items: 'not json' },
      } as never)

      const wrapper = await mountEditor()

      const field = wrapper.get('[data-field-name="line_items"]')
      expect(field.find('[data-testid="line-items-table"]').exists()).toBe(false)
      expect(field.find('input').exists()).toBe(true)
    })
  })

  describe('a failed schema/document fetch', () => {
    it('shows an error state with a Retry action instead of silently rendering 0 fields', async () => {
      vi.mocked(documentsService.fetchDocument).mockRejectedValue(new Error('network error'))

      const wrapper = mount(FieldEditor, { props: { docId: '1', docType: 'invoice' } })
      await flushPromises()

      expect(wrapper.find('[data-testid="load-error"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="type-summary"]').exists()).toBe(false)
      expect(wrapper.findAll('[data-field-name]')).toHaveLength(0)
      expect(wrapper.find('[data-testid="save-changes"]').exists()).toBe(false)
    })

    it('retries the fetch on click and shows the fields once it succeeds', async () => {
      vi.mocked(documentsService.fetchDocument).mockRejectedValueOnce(new Error('network error'))

      const wrapper = mount(FieldEditor, { props: { docId: '1', docType: 'invoice' } })
      await flushPromises()
      expect(wrapper.find('[data-testid="load-error"]').exists()).toBe(true)

      vi.mocked(documentsService.fetchDocument).mockResolvedValue(DOCUMENT as never)
      await wrapper.get('[data-testid="load-error-retry"]').trigger('click')
      await flushPromises()

      expect(wrapper.find('[data-testid="load-error"]').exists()).toBe(false)
      expect(wrapper.get('[data-testid="type-summary-count"]').text()).toBe('5 fields')
    })
  })

  // M151.9 (api.md § field_quality) — the confidence pill in the operator's
  // screenshot mock, now a verified/warning/wrong tri-state badge sourced
  // from field_quality rather than a raw confidence percentage.
  describe('per-field quality badge (M151.9)', () => {
    it('shows a quality badge only for fields that carry a field_quality tag', async () => {
      vi.mocked(documentsService.fetchDocument).mockResolvedValue({
        ...DOCUMENT,
        field_quality: { vendor_name: 'verified', total_amount: 'warning' },
      } as never)

      const wrapper = await mountEditor()

      expect(
        wrapper.get('[data-field-name="vendor_name"]').get('[data-testid="field-quality-badge"]').text(),
      ).toContain('Verified')
      expect(
        wrapper.get('[data-field-name="total_amount"]').get('[data-testid="field-quality-badge"]').text(),
      ).toContain('Check field')
      expect(wrapper.get('[data-field-name="due_date"]').find('[data-testid="field-quality-badge"]').exists()).toBe(
        false,
      )
    })

    it('renders the "wrong" tag distinctly from "verified"/"warning"', async () => {
      vi.mocked(documentsService.fetchDocument).mockResolvedValue({
        ...DOCUMENT,
        field_quality: { vendor_name: 'wrong' },
      } as never)

      const wrapper = await mountEditor()

      const badge = wrapper.get('[data-field-name="vendor_name"]').get('[data-testid="field-quality-badge"]')
      expect(badge.text()).toContain('Wrong')
      expect(badge.classes()).toContain('momentum-field-editor__quality--wrong')
    })

    it('refreshes quality tags from the save response — a just-corrected field reads verified', async () => {
      vi.mocked(documentsService.fetchDocument).mockResolvedValue({
        ...DOCUMENT,
        field_quality: { vendor_name: 'wrong' },
      } as never)
      vi.mocked(documentsService.patchDocumentFields).mockResolvedValue({
        fields: { ...DOCUMENT.fields, vendor_name: 'Acme Corp' },
        field_quality: { vendor_name: 'verified' },
        reviewed: true,
      } as never)

      const wrapper = await mountEditor()
      expect(
        wrapper.get('[data-field-name="vendor_name"]').get('[data-testid="field-quality-badge"]').text(),
      ).toContain('Wrong')

      await wrapper.get('[data-field-name="vendor_name"] input').setValue('Acme Corp')
      await wrapper.get('[data-testid="save-changes"]').trigger('click')
      await flushPromises()

      expect(
        wrapper.get('[data-field-name="vendor_name"]').get('[data-testid="field-quality-badge"]').text(),
      ).toContain('Verified')
    })
  })

  // M173.2 (backlog/v1.md) — the quality indicator moved from "sibling span
  // after the control" to "child of the same row div the control lives in",
  // with that row tinted when a quality tag is present. Scoped against a
  // pair of *adjacent* fields (sort_order 1 and 2) so the assertion can't
  // pass vacuously off a single-field document.
  describe('quality indicator anchored to its own field row (M173.2)', () => {
    it('anchors the badge inside only the flagged field\'s own row, tints that row, and leaves its unflagged neighbor untouched', async () => {
      vi.mocked(documentsService.fetchDocument).mockResolvedValue({
        ...DOCUMENT,
        field_quality: { vendor_name: 'warning' },
      } as never)

      const wrapper = await mountEditor()

      const flaggedRow = wrapper.get('[data-field-name="vendor_name"]')
      const neighborRow = wrapper.get('[data-field-name="is_paid"]')

      expect(flaggedRow.get('[data-testid="field-quality-badge"]').text()).toContain('Check field')
      expect(neighborRow.find('[data-testid="field-quality-badge"]').exists()).toBe(false)

      expect(flaggedRow.classes()).toContain('momentum-field-editor__field--quality-warning')
      expect(neighborRow.classes()).not.toContain('momentum-field-editor__field--quality-warning')
    })

    it('keeps the dirty accent and the quality tint both applied when a field is both', async () => {
      vi.mocked(documentsService.fetchDocument).mockResolvedValue({
        ...DOCUMENT,
        field_quality: { vendor_name: 'wrong' },
      } as never)

      const wrapper = await mountEditor()
      await wrapper.get('[data-field-name="vendor_name"] input').setValue('Acme Corp')

      const row = wrapper.get('[data-field-name="vendor_name"]')
      expect(row.classes()).toContain('momentum-field-editor__field--dirty')
      expect(row.classes()).toContain('momentum-field-editor__field--quality-wrong')
    })
  })

  // M173.3 (backlog/v1.md) — "warning"'s caption text reads as a call to
  // action ("check field") rather than a bare "Warning" label; "verified"
  // and "wrong" are unchanged. field_quality stays categorical throughout —
  // this only swaps the caption string, not the category or its class/icon.
  describe('warning quality caption copy (M173.3)', () => {
    it('labels a "warning" field "Check field", not "Warning"', async () => {
      vi.mocked(documentsService.fetchDocument).mockResolvedValue({
        ...DOCUMENT,
        field_quality: { vendor_name: 'verified', total_amount: 'warning' },
      } as never)

      const wrapper = await mountEditor()

      const badge = wrapper.get('[data-field-name="total_amount"]').get('[data-testid="field-quality-badge"]')
      expect(badge.text()).toContain('Check field')
      expect(badge.text()).not.toContain('Warning')
      expect(badge.classes()).toContain('momentum-field-editor__quality--warning')
    })
  })

  // M151.9 (api.md § doc_type_source and the "Undefined" classification
  // outcome) — extraction is skipped for an Undefined document, so there is
  // no field body to render for it; distinct from a needs_ocr/failed
  // document, which is also fieldless but for a different reason.
  describe('Undefined-type display (M151.9)', () => {
    it('shows an explanatory empty state with no fields and no save/review controls', async () => {
      vi.mocked(documentsService.fetchDocument).mockResolvedValue({
        id: 1,
        doc_type: null,
        status: 'done',
        reviewed: false,
      } as never)
      vi.mocked(documentsService.fetchDocumentTypeSchema).mockClear()

      const wrapper = mount(FieldEditor, {
        props: { docId: '1', docType: '', docTypeSource: 'none' },
      })
      await flushPromises()

      expect(wrapper.find('[data-testid="undefined-type-message"]').exists()).toBe(true)
      expect(wrapper.findAll('[data-field-name]')).toHaveLength(0)
      expect(wrapper.find('[data-testid="save-changes"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="toggle-reviewed"]').exists()).toBe(false)
      expect(documentsService.fetchDocumentTypeSchema).not.toHaveBeenCalled()
    })

    it('does not show the Undefined message for an ordinary not-yet-classified (pending) document', async () => {
      vi.mocked(documentsService.fetchDocument).mockResolvedValue({
        id: 1,
        doc_type: null,
        status: 'pending',
        reviewed: false,
      } as never)

      const wrapper = mount(FieldEditor, {
        props: { docId: '1', docType: '', docTypeSource: 'ai' },
      })
      await flushPromises()

      expect(wrapper.find('[data-testid="undefined-type-message"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="reprocessing-message"]').exists()).toBe(true)
    })
  })
})
