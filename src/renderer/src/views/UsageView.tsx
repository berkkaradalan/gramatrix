import type { ReactNode } from 'react'
import { UsageReportView } from '../components/usage/UsageReportView'
import { PageHeader } from '../components/ui'

const ALL_PROJECTS = {}

export function UsageView(): ReactNode {
  return (
    <div className="page">
      <div className="page-column">
        <PageHeader title="Usage" description="What your agents used, across every project." />
        <UsageReportView query={ALL_PROJECTS} />
      </div>
    </div>
  )
}
