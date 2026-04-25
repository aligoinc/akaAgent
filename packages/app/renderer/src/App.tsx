import { useState } from 'react'
import { WorkflowsPage } from './pages/WorkflowsPage'
import { RunsPage } from './pages/RunsPage'
import { ChannelsPage } from './pages/ChannelsPage'
import { SelectorLibraryPage } from './pages/SelectorLibraryPage'
import { DataTablesPage } from './pages/DataTablesPage'
import { TriggersPage } from './pages/TriggersPage'
import { ConnectionsPage } from './pages/ConnectionsPage'
import { CampaignViewsPage } from './pages/CampaignViewsPage'

type Page = 'campaigns' | 'workflows' | 'datatables' | 'triggers' | 'channels' | 'selectors' | 'connections' | 'runs'

export default function App(): JSX.Element {
  const [page, setPage] = useState<Page>('campaigns')
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null)

  const tab = (key: Page, label: string): JSX.Element => (
    <a className={page === key ? 'active' : ''} onClick={() => { setPage(key); if (key !== 'workflows') setSelectedWorkflowId(null) }}>
      {label}
    </a>
  )

  return (
    <div className="layout">
      <header className="topbar">
        <h1>akaBiz Auto v2</h1>
        <nav>
          {tab('campaigns', 'Chiến dịch')}
          {tab('workflows', 'Workflows')}
          {tab('datatables', 'DataTables')}
          {tab('triggers', 'Triggers')}
          {tab('channels', 'Channels')}
          {tab('selectors', 'Selectors')}
          {tab('connections', 'Connections')}
          {tab('runs', 'Runs')}
        </nav>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#888' }}>Phase 9</span>
      </header>
      <main className="page">
        {page === 'campaigns' && <CampaignViewsPage />}
        {page === 'workflows' && (
          <WorkflowsPage
            selectedId={selectedWorkflowId}
            onSelect={setSelectedWorkflowId}
            onBack={() => setSelectedWorkflowId(null)}
          />
        )}
        {page === 'datatables' && <DataTablesPage />}
        {page === 'triggers' && <TriggersPage />}
        {page === 'runs' && <RunsPage />}
        {page === 'channels' && <ChannelsPage />}
        {page === 'selectors' && <SelectorLibraryPage />}
        {page === 'connections' && <ConnectionsPage />}
      </main>
    </div>
  )
}
