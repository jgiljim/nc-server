import { describe, expect, it } from 'vitest'
import { EXCLUDED_COLUMN_KEYS, excludeStaticColumns } from './columnExclusion'
import type { ColumnDef } from '../types'

describe('excludeStaticColumns', () => {
  it('drops any column whose key is in EXCLUDED_COLUMN_KEYS', () => {
    const columns: ColumnDef[] = [
      { key: 'doc_id', label: 'Doc ID' },
      { key: 'filename', label: 'Filename' },
      { key: 'status', label: 'Status' },
    ]

    expect(excludeStaticColumns(columns).map((c) => c.key)).toEqual(['filename', 'status'])
  })

  it('excludes doc_id specifically (Phase 50: public_id carries no user-facing information)', () => {
    expect(EXCLUDED_COLUMN_KEYS.has('doc_id')).toBe(true)
  })

  it('is a no-op when no column matches the exclusion list', () => {
    const columns: ColumnDef[] = [{ key: 'filename', label: 'Filename' }]
    expect(excludeStaticColumns(columns)).toEqual(columns)
  })
})
