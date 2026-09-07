import { describe, expect, it } from 'vitest'
import { mimeTypeToIcon, mimeTypeToIconColor } from './mimeTypeToIcon'
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

describe('mimeTypeToIcon', () => {
  it('renders a directory as a folder, not as a document', () => {
    // `httpd/unix-directory` is Nextcloud's own mime type for a folder and is
    // what the file browser (M123.2) passes for folder rows; falling through to
    // the generic file icon made every folder look like a document (seen on the
    // running instance, 2026-08-25).
    expect(mimeTypeToIcon('httpd/unix-directory')).toBe(FolderIcon)
  })

  it('maps application/pdf to FilePdfBox', () => {
    expect(mimeTypeToIcon('application/pdf')).toBe(FilePdfBoxIcon)
  })

  it('maps Word MIME types (exact and prefixed) to FileWordBox', () => {
    expect(mimeTypeToIcon('application/msword')).toBe(FileWordBoxIcon)
    expect(
      mimeTypeToIcon(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ),
    ).toBe(FileWordBoxIcon)
    expect(mimeTypeToIcon('application/vnd.oasis.opendocument.text')).toBe(FileWordBoxIcon)
  })

  it('maps Excel MIME types (exact and prefixed) to FileExcelBox', () => {
    expect(mimeTypeToIcon('application/vnd.ms-excel')).toBe(FileExcelBoxIcon)
    expect(
      mimeTypeToIcon('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    ).toBe(FileExcelBoxIcon)
    expect(mimeTypeToIcon('application/vnd.oasis.opendocument.spreadsheet')).toBe(
      FileExcelBoxIcon,
    )
  })

  it('maps PowerPoint MIME types (exact and prefixed) to FilePowerpointBox', () => {
    expect(mimeTypeToIcon('application/vnd.ms-powerpoint')).toBe(FilePowerpointBoxIcon)
    expect(
      mimeTypeToIcon(
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      ),
    ).toBe(FilePowerpointBoxIcon)
    expect(mimeTypeToIcon('application/vnd.oasis.opendocument.presentation')).toBe(
      FilePowerpointBoxIcon,
    )
  })

  it('maps any image/* subtype to FileImage', () => {
    expect(mimeTypeToIcon('image/png')).toBe(FileImageIcon)
    expect(mimeTypeToIcon('image/jpeg')).toBe(FileImageIcon)
  })

  it('maps text/plain to FileDocumentOutline', () => {
    expect(mimeTypeToIcon('text/plain')).toBe(FileDocumentOutlineIcon)
  })

  it('falls back to FileOutline for unmapped or missing MIME types', () => {
    expect(mimeTypeToIcon('application/octet-stream')).toBe(FileOutlineIcon)
    expect(mimeTypeToIcon(undefined)).toBe(FileOutlineIcon)
  })
})

describe('mimeTypeToIconColor', () => {
  it('gives each file-type family a distinct color', () => {
    const colors = new Set([
      mimeTypeToIconColor('application/pdf'),
      mimeTypeToIconColor('application/msword'),
      mimeTypeToIconColor('application/vnd.ms-excel'),
      mimeTypeToIconColor('application/vnd.ms-powerpoint'),
      mimeTypeToIconColor('image/png'),
    ])
    expect(colors.size).toBe(5)
  })

  it('resolves prefixed MIME types to the same color as their exact-match family', () => {
    expect(
      mimeTypeToIconColor('application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    ).toBe(mimeTypeToIconColor('application/msword'))
    expect(
      mimeTypeToIconColor('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    ).toBe(mimeTypeToIconColor('application/vnd.ms-excel'))
    expect(mimeTypeToIconColor('application/vnd.oasis.opendocument.text')).toBe(
      mimeTypeToIconColor('application/msword'),
    )
  })

  it('falls back to a neutral color for unmapped or missing MIME types', () => {
    const fallback = mimeTypeToIconColor(undefined)
    expect(mimeTypeToIconColor('application/octet-stream')).toBe(fallback)
    expect(fallback).not.toBe(mimeTypeToIconColor('application/pdf'))
  })
})
