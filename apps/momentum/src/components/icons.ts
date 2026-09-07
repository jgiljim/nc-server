// Centralized icon components for the frontend. `@nextcloud/vue` takes icons
// as Vue components (from `vue-material-design-icons`) passed via named slots
// or `:icon`, never as string names (CLAUDE.md § Frontend coding rules —
// "Icons are components, not string constants"). Importing them here gives a
// single place that owns the icon set, mirroring the discipline the old
// `ICON_*` constants enforced — just as components instead of strings.
export { default as FilterIcon } from 'vue-material-design-icons/FilterVariant.vue'
export { default as ColumnsIcon } from 'vue-material-design-icons/ViewColumn.vue'
export { default as CloseIcon } from 'vue-material-design-icons/Close.vue'
// Boolean-cell glyphs for VirtualTable (frontend.md § VirtualTable): a boolean
// cell renders as a check/cross icon rather than the text "true"/"false".
export { default as CheckIcon } from 'vue-material-design-icons/Check.vue'
// Sort-direction glyphs for VirtualTable's clickable sortable headers
// (frontend.md § DocumentList "Table": "↑ / ↓ arrow icon").
export { default as ArrowUpIcon } from 'vue-material-design-icons/ArrowUp.vue'
export { default as ArrowDownIcon } from 'vue-material-design-icons/ArrowDown.vue'
// DocumentList toolbar item 5, "Add new" (frontend.md § DocumentList toolbar).
export { default as PlusIcon } from 'vue-material-design-icons/Plus.vue'
// File-type icons for the `filename` column (frontend.md § File-Type Icons),
// resolved per row by `mimeTypeToIcon`.
export { default as FilePdfBoxIcon } from 'vue-material-design-icons/FilePdfBox.vue'
export { default as FileWordBoxIcon } from 'vue-material-design-icons/FileWordBox.vue'
export { default as FileExcelBoxIcon } from 'vue-material-design-icons/FileExcelBox.vue'
export { default as FilePowerpointBoxIcon } from 'vue-material-design-icons/FilePowerpointBox.vue'
export { default as FileImageIcon } from 'vue-material-design-icons/FileImage.vue'
export { default as FileDocumentOutlineIcon } from 'vue-material-design-icons/FileDocumentOutline.vue'
export { default as FileOutlineIcon } from 'vue-material-design-icons/FileOutline.vue'
// Directories, for the file browser (M123.2): Nextcloud's own mime type for a
// folder is `httpd/unix-directory`, which the generic file icon would
// otherwise represent as a document.
export { default as FolderIcon } from 'vue-material-design-icons/Folder.vue'
// Document Viewer's "Document information" disclosure toggle
// (specs/mockup-ai-document-manager.html's `.doc-info > summary .msym`
// chevron, rotated 90deg when open).
export { default as ChevronRightIcon } from 'vue-material-design-icons/ChevronRight.vue'
// Document Viewer's top bar (M139.1, frontend.md § Document Viewer & Field
// Editor "Top bar"): Back button and the Reviewed pill, matching the
// mockup's `arrow_back` / `check_circle` glyphs.
export { default as ArrowLeftIcon } from 'vue-material-design-icons/ArrowLeft.vue'
export { default as CheckCircleIcon } from 'vue-material-design-icons/CheckCircle.vue'
// AiStatusStrip (M149.1, frontend.md § Processing progress: the AI status
// strip), matching the mockup's `#ai-strip` sparkle glyph.
export { default as CreationOutlineIcon } from 'vue-material-design-icons/CreationOutline.vue'
// FieldEditor's per-field quality badge (M151.9, api.md § field_quality —
// "verified"/"warning"/"wrong" tri-state, the confidence pill in the
// operator's screenshot mock) — CheckCircleIcon above doubles as "verified".
export { default as AlertCircleOutlineIcon } from 'vue-material-design-icons/AlertCircleOutline.vue'
export { default as CloseCircleOutlineIcon } from 'vue-material-design-icons/CloseCircleOutline.vue'
// DocumentViewerPage's Undefined-type control (M151.9, api.md § doc_type_source
// and the "Undefined" classification outcome) — matches the mockup's
// unclassified-state glyph vocabulary.
export { default as HelpCircleOutlineIcon } from 'vue-material-design-icons/HelpCircleOutline.vue'
// DocumentList empty states (M178.1, backlog/v1.md Phase 178): the "no
// documents at all" glyph reuses the same file-outline vocabulary as the
// mime-type icon set above; "no documents match the active filters" gets its
// own glyph so the two empty states read as visibly distinct.
export { default as FilterOffOutlineIcon } from 'vue-material-design-icons/FilterOffOutline.vue'
