import { useState } from 'react'
import { WorkflowsPage } from './pages/WorkflowsPage'
import { RunsPage } from './pages/RunsPage'
import { ChannelsPage } from './pages/ChannelsPage'

type Page = 'workflows' | 'runs' | 'channels'

export default function App(): JSX.Element {
  const [page, setPage] = useState<Page>('workflows')
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null)

  return (
    <div className="layout">
      <header className="topbar">
        <h1>akaBiz Auto v2</h1>
        <nav>
          <a className={page === 'workflows' ? 'active' : ''} onClick={() => { setPage('workflows'); setSelectedWorkflowId(null) }}>Workflows</a>
          <a className={page === 'runs' ? 'active' : ''} onClick={() => setPage('runs')}>Runs</a>
          <a className={page === 'channels' ? 'active' : ''} onClick={() => setPage('channels')}>Channels</a>
        </nav>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#888' }}>Phase 7a — minimum viable UI</span>
      </header>
      <main className="page">
        {page === 'workflows' && (
          <WorkflowsPage
            selectedId={selectedWorkflowId}
            onSelect={setSelectedWorkflowId}
            onBack={() => setSelectedWorkflowId(null)}
          />
        )}
        {page === 'runs' && <RunsPage />}
        {page === 'channels' && <ChannelsPage />}
      </main>
    </div>
  )
}
