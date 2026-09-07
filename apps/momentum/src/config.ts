// Single source of truth for tunable frontend constants (frontend.md §
// Frontend Configuration). No numeric literals or magic strings are scattered
// through component code — every component that needs a constant imports it
// from here. `as const` narrows values to their literal types so accidental
// mutation is a compile error, and any value that later becomes user-
// configurable changes in exactly one place.
export const MOMENTUM_CONFIG = {
  // Typeahead search
  SEARCH_DEBOUNCE_MS: 200,

  // Virtual table — number of rows from the bottom of the loaded set that
  // triggers fetching the next page.
  SCROLL_PREFETCH_ROWS: 3,

  // Document viewer — polling interval when a document is in pending or
  // processing status (review.md G6).
  DOCUMENT_POLL_INTERVAL_MS: 5_000,

  // Document viewer — how long the page keeps waiting for a pending/processing
  // document to reach a terminal status before it stops polling and says the
  // wait has stalled (M129.2, frontend.md § Special status states). A re-run
  // whose job dead-letters leaves the document `pending` for ever, so an
  // unbounded wait is a spinner that never resolves. Sized off the real thing
  // rather than a round number: a full pipeline pass over a real document
  // (extract text, embed, classify, extract fields — all Model Hub round
  // trips) lands in tens of seconds, and the queue's own retry backoff can
  // legitimately push a re-run past that, so three minutes is comfortably
  // longer than a slow success and far shorter than "for ever". Being wrong in
  // the impatient direction is cheap: the state it shows is not a verdict, and
  // Check again resumes the wait.
  DOCUMENT_PROCESSING_TIMEOUT_MS: 180_000,

  // Column picker — localStorage key prefix; suffixed with the type_name or
  // 'recent' (see COLUMN_PICKER_STORAGE_PREFIX usage in ColumnPicker).
  COLUMN_PICKER_STORAGE_PREFIX: 'momentum_columns_',

  // Document viewer — left/right panel split (fraction of total width).
  VIEWER_PANEL_SPLIT: 0.5,

  // NC notify_push custom event name for terminal status/reviewed pushes
  // (frontend.md § Processing status; architecture.md § NC notify_push).
  MOMENTUM_STATUS_PUSH_EVENT: 'momentum_status',

  // Newly-shared items hint (frontend.md § Newly-shared items:
  // eventual-consistency affordance) — localStorage key that remembers a
  // user has dismissed the hint, so it stays dismissed across reloads.
  NEWLY_SHARED_HINT_STORAGE_KEY: 'momentum_newly_shared_hint_dismissed',

  // AI status strip (M157.3, frontend.md § Processing progress: the AI status
  // strip) — tenant-wide `GET /stats/overview` poll interval. Deliberately its
  // own constant rather than a reuse of DOCUMENT_POLL_INTERVAL_MS: that one
  // polls a single document while it is pending/processing, this one polls
  // the whole tenant unconditionally from mount, so the two contracts can be
  // tuned independently.
  AI_STRIP_POLL_INTERVAL_MS: 5_000,

  // AI status strip (M157.2) — consecutive poll failures before the strip
  // stops asserting a count it can no longer substantiate. 3 misses at
  // AI_STRIP_POLL_INTERVAL_MS (5s) is 15s of staleness before the strip says
  // so — long enough to ride out a single dropped request or transient 5xx
  // without flapping, short enough that "stale" still means something by the
  // time it's shown.
  AI_STRIP_STALE_AFTER_FAILURES: 3,
} as const
