"use client"

import { LibraryPageShell } from '@/components/library/LibraryPageShell'
import { ProjectGrid } from '@/components/library/project-grid'
import { useI18n } from '@/lib/i18n/provider'

export function LibraryPageClient() {
  const { t } = useI18n()

  return (
    <LibraryPageShell title={t('library.title')} description={t('library.description')}>
      <ProjectGrid />
    </LibraryPageShell>
  )
}
