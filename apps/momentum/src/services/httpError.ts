// Carries the HTTP status alongside the message so a caller can tell a thin-A
// 503 ("access re-verification unavailable" — backend/internal/api's
// writeDocumentByInternalID etc.) apart from every other failure, rather than
// pattern-matching the message string (backlog Phase 165 / M165.2).
//
// Kept in its own module, separate from `documents.ts`: most callers of
// `documents.ts` auto-mock the whole module with `vi.mock('../services/documents')`
// (see e.g. DocumentViewerPage.unit.test.ts), and Vitest's automocking strips a
// mocked class's own constructor body — `new HttpError(503, path).status` comes
// back `undefined` under that automock. A real `HttpError` a test can construct
// and inspect has to live somewhere that mocking doesn't reach.
export class HttpError extends Error {
  constructor(readonly status: number, path: string) {
    super(`${path} responded with ${status}`)
    this.name = 'HttpError'
  }
}
