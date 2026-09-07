// mime_type -> file-type icon component lookup for the `filename` column
// (frontend.md § File-Type Icons). Exact MIME type matches first, then
// longest matching prefix; anything unmapped (or a missing mime_type) falls
// back to the generic icon, never a blank cell.
import type { Component } from 'vue'
import {
  FileDocumentOutlineIcon,
  FileExcelBoxIcon,
  FileImageIcon,
  FileOutlineIcon,
  FilePdfBoxIcon,
  FilePowerpointBoxIcon,
  FileWordBoxIcon,
  FolderIcon,
} from './icons'

const EXACT_MATCHES: Record<string, Component> = {
  // Nextcloud's own mime type for a directory (M123.2's file browser passes it
  // for folder rows). Without this a folder renders as a document.
  'httpd/unix-directory': FolderIcon,
  'application/pdf': FilePdfBoxIcon,
  'application/msword': FileWordBoxIcon,
  'application/vnd.oasis.opendocument.text': FileWordBoxIcon,
  'application/vnd.ms-excel': FileExcelBoxIcon,
  'application/vnd.oasis.opendocument.spreadsheet': FileExcelBoxIcon,
  'application/vnd.ms-powerpoint': FilePowerpointBoxIcon,
  'application/vnd.oasis.opendocument.presentation': FilePowerpointBoxIcon,
  'text/plain': FileDocumentOutlineIcon,
}

const PREFIX_MATCHES: Array<[string, Component]> = [
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.', FileWordBoxIcon],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.', FileExcelBoxIcon],
  ['application/vnd.openxmlformats-officedocument.presentationml.', FilePowerpointBoxIcon],
  ['image/', FileImageIcon],
]

export function mimeTypeToIcon(mimeType: string | undefined | null): Component {
  if (!mimeType) {
    return FileOutlineIcon
  }
  if (mimeType in EXACT_MATCHES) {
    return EXACT_MATCHES[mimeType]
  }
  let longestMatch: Component | undefined
  let longestMatchLength = -1
  for (const [prefix, icon] of PREFIX_MATCHES) {
    if (mimeType.startsWith(prefix) && prefix.length > longestMatchLength) {
      longestMatch = icon
      longestMatchLength = prefix.length
    }
  }
  return longestMatch ?? FileOutlineIcon
}

// The generic-fallback color: neutral so an unrecognized/missing mime_type
// doesn't compete with the deliberately saturated per-type colors below.
const NEUTRAL_ICON_COLOR = 'var(--color-text-maxcontrast)'

// Distinct, recognizable colors per file-type family (frontend.md § File-Type
// Icons) — the `*Box` icon glyphs are near-identical solid shapes at small
// sizes, so without per-type color they read as an indistinguishable dark
// blob rather than a recognizable file-type cue.
const EXACT_COLORS: Record<string, string> = {
  'application/pdf': '#e53935',
  'application/msword': '#2b579a',
  'application/vnd.oasis.opendocument.text': '#2b579a',
  'application/vnd.ms-excel': '#217346',
  'application/vnd.oasis.opendocument.spreadsheet': '#217346',
  'application/vnd.ms-powerpoint': '#d24726',
  'application/vnd.oasis.opendocument.presentation': '#d24726',
  'text/plain': NEUTRAL_ICON_COLOR,
}

const PREFIX_COLORS: Array<[string, string]> = [
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.', '#2b579a'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.', '#217346'],
  ['application/vnd.openxmlformats-officedocument.presentationml.', '#d24726'],
  ['image/', '#7e57c2'],
]

export function mimeTypeToIconColor(mimeType: string | undefined | null): string {
  if (!mimeType) {
    return NEUTRAL_ICON_COLOR
  }
  if (mimeType in EXACT_COLORS) {
    return EXACT_COLORS[mimeType]
  }
  let longestMatch: string | undefined
  let longestMatchLength = -1
  for (const [prefix, color] of PREFIX_COLORS) {
    if (mimeType.startsWith(prefix) && prefix.length > longestMatchLength) {
      longestMatch = color
      longestMatchLength = prefix.length
    }
  }
  return longestMatch ?? NEUTRAL_ICON_COLOR
}
