// Byte payloads the mock DAV endpoint (see `server.ts`) serves back for each
// `MockDocument.file_key` (mock/fixtures.ts) — just enough for the browser's
// native PDF/image/text rendering (or the mock `OCA.Viewer` stub in
// `host.ts`) to show *something* in the Document Viewer's preview pane. Not
// real extraction input — the pipeline that would read these bytes isn't
// running in this mock at all (see README.md).

// A minimal, hand-built single-page PDF (no compression, a loose xref table)
// — small enough to inline, and every mainstream browser's built-in PDF
// renderer recovers a broken/omitted xref via a linear object scan, so a
// byte-exact cross-reference table isn't needed for it to render.
const MOCK_PDF_TEXT = `%PDF-1.1
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 400 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 66>>
stream
BT /F1 16 Tf 20 100 Td (Mock document - glue-app dev harness) Tj ET
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Size 6/Root 1 0 R>>
%%EOF
`

const MOCK_TEXT = `Momentum mock document

This file is served by glue-app/mock's dev-only mock backend
(see glue-app/mock/README.md) so the Document Viewer's preview
pane has something to render. It has no relation to the document's
extracted fields, which come from mock/fixtures.ts instead.
`

// A 1x1 black PNG pixel — real image bytes so <img>/native preview handling
// exercises the actual code path, not a stand-in string.
const MOCK_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

export interface MockFile {
  mime: string
  bytes: Buffer
}

const FILES: Record<'pdf' | 'text' | 'image', MockFile> = {
  pdf: { mime: 'application/pdf', bytes: Buffer.from(MOCK_PDF_TEXT, 'utf-8') },
  text: { mime: 'text/plain', bytes: Buffer.from(MOCK_TEXT, 'utf-8') },
  image: { mime: 'image/png', bytes: Buffer.from(MOCK_PNG_BASE64, 'base64') },
}

export function getMockFile(key: 'pdf' | 'text' | 'image'): MockFile {
  return FILES[key]
}
