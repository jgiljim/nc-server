// Static data behind the mock backend (see `README.md` in this directory).
// Shapes mirror `frontend/src/api/schema.d.ts`'s `api.documentDTO` /
// `api.searchItemDTO` / `api.documentTypeSchemaResponse` — hand-typed here
// rather than imported, since this tree runs standalone (no backend/frontend
// build) and only needs the field names, not the generated module.
//
// Field names/types below are lifted from `specs/document-types/commercial.md`
// and `specs/document-types/finance.md` so the mocked schemas look like the
// real ones a frontend engineer will eventually see, not placeholder
// `field1`/`field2` names.

export interface MockFieldDefinition {
  field_name: string
  display_name: string
  data_type: 'string' | 'int64' | 'double' | 'date' | 'boolean'
  description: string
  operators: string[]
  value_set: string[] | null
}

export interface MockDocumentType {
  type_name: string
  display_name: string
  direction: string
  description: string
  fields: MockFieldDefinition[]
}

function field(
  field_name: string,
  data_type: MockFieldDefinition['data_type'],
  display_name: string,
  description: string,
): MockFieldDefinition {
  return { field_name, data_type, display_name, description, operators: ['eq', 'not_eq'], value_set: null }
}

const SUMMARY_FIELD = field(
  'document_general_summary',
  'string',
  'Summary',
  'One-paragraph AI-generated summary of the document.',
)

export const DOCUMENT_TYPES: MockDocumentType[] = [
  {
    type_name: 'commercial_invoice',
    display_name: 'Invoice',
    direction: 'variable',
    description: 'Request for payment for goods or services delivered.',
    fields: [
      field('invoice_number', 'string', 'Invoice number', 'Unique invoice identifier'),
      field('invoice_date', 'date', 'Invoice date', 'Date the invoice was issued'),
      field('due_date', 'date', 'Due date', 'Date by which payment is required'),
      field('seller_name', 'string', 'Seller', 'Legal name of the seller'),
      field('seller_iban', 'string', 'Seller IBAN', "Seller's bank account IBAN for payment"),
      field('buyer_name', 'string', 'Buyer', 'Legal name of the buyer'),
      field('line_items', 'string', 'Line items', 'JSON array: description, quantity, unit_price, line_total_net'),
      field('total_gross', 'double', 'Total (gross)', 'Total amount due including all taxes'),
      field('currency', 'string', 'Currency', 'ISO 4217 currency code'),
      field('po_reference', 'string', 'PO reference', "Buyer's purchase order number"),
      SUMMARY_FIELD,
    ],
  },
  {
    type_name: 'finance_bank_statement',
    display_name: 'Bank Statement',
    direction: 'inbound',
    description: 'Periodic listing of all transactions on a bank account.',
    fields: [
      field('bank_name', 'string', 'Bank', 'Name of the financial institution'),
      field('account_holder_name', 'string', 'Account holder', 'Name of the account holder'),
      field('iban', 'string', 'IBAN', 'International Bank Account Number'),
      field('statement_period_start', 'date', 'Period start', 'First day of the statement cycle'),
      field('statement_period_end', 'date', 'Period end', 'Last day of the statement cycle'),
      field('statement_number', 'string', 'Statement number', 'Unique reference for this statement'),
      field('opening_balance', 'double', 'Opening balance', 'Account balance at the start of the period'),
      field('total_credits', 'double', 'Total credits', 'Sum of all incoming transactions'),
      field('total_debits', 'double', 'Total debits', 'Sum of all outgoing transactions'),
      field('closing_balance', 'double', 'Closing balance', 'Account balance at the end of the period'),
      field('currency', 'string', 'Currency', 'ISO 4217 currency code'),
      SUMMARY_FIELD,
    ],
  },
  {
    type_name: 'finance_expense',
    display_name: 'Expense Claim',
    direction: 'inbound',
    description: 'Summary of business expenses submitted for reimbursement.',
    fields: [
      field('claimant_name', 'string', 'Claimant', 'Full name of the person submitting the claim'),
      field('submission_date', 'date', 'Submission date', 'Date the claim was submitted'),
      field('expense_description', 'string', 'Description', 'What was purchased and the business reason'),
      field('line_items', 'string', 'Line items', 'JSON array: date, category, description, amount, currency'),
      field('total_claimed', 'double', 'Total claimed', 'Grand total of all expenses claimed'),
      field('currency', 'string', 'Currency', 'ISO 4217 currency code'),
      field('receipt_attached', 'boolean', 'Receipt attached', 'Whether supporting receipts are included'),
      SUMMARY_FIELD,
    ],
  },
]

export interface MockDocument {
  public_id: string
  path: string
  mime_type: string
  doc_type: string
  direction: string
  status: 'pending' | 'processing' | 'done' | 'needs_ocr' | 'failed'
  reviewed: boolean
  created_at: string
  updated_at: string
  fields: Record<string, unknown>
  /**
   * Per-field extraction-consistency tag (api.md § field_quality, M151.9's
   * FieldEditor badge/border rendering) — omitted entirely for documents
   * seeded before that feature, same as a real pre-M151 row would have no
   * column value. Only a field actually present in `fields` needs an entry.
   */
  field_quality?: Record<string, 'verified' | 'warning' | 'wrong'>
  /** Key into FILE_CONTENT (mock/files.ts) — the bytes served over mock DAV for this doc's `path`. */
  file_key: 'pdf' | 'text' | 'image'
  /**
   * Nextcloud fileid — a small int here, matching the type real fileids are
   * (`services/documents.ts`'s `fetchDocumentByFileId(fileId: number)`).
   * `host.ts`'s mock "files" View puts this on the `File` node it constructs
   * for the document (`File.fileid`), and `server.ts`'s
   * `GET /documents/by-file/:fileId` looks documents up by it — the same
   * fileid -> document resolution `FileBrowserPage.vue`'s row click does for
   * real against the Go backend.
   */
  file_id: number
}

// A handful of documents spanning every pipeline status
// (`specs/frontend.md` § Special status states) and all three mocked types,
// so the frontend/HiDrive team can see every state the Documents table and
// Document Viewer render without needing a real pipeline run.
export const DOCUMENTS: MockDocument[] = [
  {
    public_id: 'mock-doc-invoice-1',
    path: '/mock-user/files/Momentum Demo/acme-invoice-2461.pdf',
    mime_type: 'application/pdf',
    doc_type: 'commercial_invoice',
    direction: 'inbound',
    status: 'done',
    reviewed: false,
    created_at: '2026-08-20T09:12:00Z',
    updated_at: '2026-08-20T09:14:31Z',
    file_key: 'pdf',
    file_id: 101,
    fields: {
      invoice_number: 'INV-2461',
      invoice_date: '2026-08-15',
      due_date: '2026-09-14',
      seller_name: 'Acme Supplies GmbH',
      seller_iban: 'DE89370400440532013000',
      buyer_name: 'Momentum Demo Tenant',
      line_items: JSON.stringify([
        { description: 'Printer paper, A4 (10 reams)', quantity: 10, unit_price: 4.5, line_total_net: 45 },
        { description: 'Toner cartridge, black', quantity: 2, unit_price: 62.0, line_total_net: 124 },
      ]),
      total_gross: 201.11,
      currency: 'EUR',
      po_reference: 'PO-90210',
      document_general_summary:
        'Invoice from Acme Supplies GmbH for office supplies (paper, toner), due 2026-09-14.',
    },
  },
  {
    public_id: 'mock-doc-invoice-2',
    path: '/mock-user/files/Momentum Demo/globex-invoice-0099.pdf',
    mime_type: 'application/pdf',
    doc_type: 'commercial_invoice',
    direction: 'outbound',
    status: 'done',
    reviewed: true,
    created_at: '2026-08-18T14:02:00Z',
    updated_at: '2026-08-19T08:00:00Z',
    file_key: 'pdf',
    file_id: 102,
    fields: {
      invoice_number: 'GLB-0099',
      invoice_date: '2026-08-01',
      due_date: '2026-08-31',
      seller_name: 'Momentum Demo Tenant',
      seller_iban: 'DE12500105170648489890',
      buyer_name: 'Globex Corporation',
      line_items: JSON.stringify([
        { description: 'Consulting services, August', quantity: 1, unit_price: 4200, line_total_net: 4200 },
      ]),
      total_gross: 4998,
      currency: 'EUR',
      po_reference: '',
      document_general_summary: 'Invoice to Globex Corporation for August consulting services.',
    },
  },
  {
    public_id: 'mock-doc-invoice-3',
    path: '/mock-user/files/Momentum Demo/initech-invoice-7734.pdf',
    mime_type: 'application/pdf',
    doc_type: 'commercial_invoice',
    direction: 'inbound',
    status: 'done',
    reviewed: false,
    created_at: '2026-09-05T10:00:00Z',
    updated_at: '2026-09-05T10:03:00Z',
    file_key: 'pdf',
    file_id: 107,
    // field_quality showcase (api.md § field_quality; FieldEditor's
    // verified/warning/wrong badge + row tint) — mirrors a real multi-run
    // extraction result: most fields agree across runs (verified), one date
    // needed a human glance (warning), and the model's two runs disagreed
    // outright on the seller name (wrong, first run's value kept).
    fields: {
      invoice_number: 'INV-7734',
      invoice_date: '2026-08-30',
      due_date: '2026-09-29',
      seller_name: 'Initech Corp',
      seller_iban: 'DE02120300000000202051',
      buyer_name: 'Momentum Demo Tenant',
      line_items: JSON.stringify([
        { description: 'Annual software license renewal', quantity: 1, unit_price: 3400, line_total_net: 3400 },
      ]),
      total_gross: 4046,
      currency: 'EUR',
      po_reference: 'PO-55210',
      document_general_summary: 'Invoice from Initech Corp for an annual software license renewal, due 2026-09-29.',
    },
    field_quality: {
      invoice_number: 'verified',
      invoice_date: 'warning',
      due_date: 'verified',
      seller_name: 'wrong',
      seller_iban: 'verified',
      buyer_name: 'verified',
      line_items: 'verified',
      total_gross: 'verified',
      currency: 'verified',
      po_reference: 'verified',
      document_general_summary: 'wrong',
    },
  },
  {
    public_id: 'mock-doc-statement-1',
    path: '/mock-user/files/Momentum Demo/sparkasse-statement-july.pdf',
    mime_type: 'application/pdf',
    doc_type: 'finance_bank_statement',
    direction: 'inbound',
    status: 'done',
    reviewed: false,
    created_at: '2026-08-01T07:30:00Z',
    updated_at: '2026-08-01T07:33:12Z',
    file_key: 'pdf',
    file_id: 103,
    fields: {
      bank_name: 'Sparkasse Musterstadt',
      account_holder_name: 'Momentum Demo Tenant',
      iban: 'DE44500105175407324931',
      statement_period_start: '2026-07-01',
      statement_period_end: '2026-07-31',
      statement_number: 'ST-2026-07',
      opening_balance: 18420.55,
      total_credits: 9800.0,
      total_debits: 6120.4,
      closing_balance: 22100.15,
      currency: 'EUR',
      document_general_summary: 'July bank statement for Momentum Demo Tenant, closing balance 22,100.15 EUR.',
    },
  },
  {
    public_id: 'mock-doc-expense-1',
    path: '/mock-user/files/Momentum Demo/travel-expenses-berlin.pdf',
    mime_type: 'application/pdf',
    doc_type: 'finance_expense',
    direction: 'inbound',
    status: 'processing',
    reviewed: false,
    created_at: '2026-09-02T16:45:00Z',
    updated_at: '2026-09-02T16:45:00Z',
    file_key: 'pdf',
    file_id: 104,
    fields: {},
  },
  {
    public_id: 'mock-doc-expense-2',
    path: '/mock-user/files/Momentum Demo/office-supplies-receipt.txt',
    mime_type: 'text/plain',
    doc_type: 'finance_expense',
    direction: 'inbound',
    status: 'needs_ocr',
    reviewed: false,
    created_at: '2026-08-28T10:05:00Z',
    updated_at: '2026-08-28T10:06:00Z',
    file_key: 'text',
    file_id: 105,
    fields: {},
  },
  {
    public_id: 'mock-doc-scan-1',
    path: '/mock-user/files/Momentum Demo/scanned-receipt.png',
    mime_type: 'image/png',
    doc_type: 'finance_expense',
    direction: 'inbound',
    status: 'failed',
    reviewed: false,
    created_at: '2026-08-25T11:20:00Z',
    updated_at: '2026-08-25T11:22:00Z',
    file_key: 'image',
    file_id: 106,
    fields: {},
  },
]

export function findDocument(publicId: string): MockDocument | undefined {
  return DOCUMENTS.find((doc) => doc.public_id === publicId)
}

export function findDocumentType(typeName: string): MockDocumentType | undefined {
  return DOCUMENT_TYPES.find((type) => type.type_name === typeName)
}
