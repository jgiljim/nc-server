// Entry point for `npm run mock` (see README.md). Order matters: `./host`
// must finish setting up the window/document mocks before `../src/main`
// evaluates, since `services/documents.ts` and `router/index.ts` both call
// `generateUrl()` at module-import time.
import './host'
import '../src/main'
