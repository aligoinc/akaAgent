import { useEffect } from 'react'
import Editor from '@monaco-editor/react'
import { initMonaco } from '../../lib/monacoSetup'
import { useThemeStore } from '../../stores/themeStore'

export default function AdminSqlViewer({ value }: { value: string }) {
  const theme = useThemeStore(state => state.theme)
  useEffect(() => { initMonaco() }, [])
  return <div className="admin-sql-viewer"><Editor language="sql" value={value} theme={theme === 'light' ? 'vs-light' : 'vs-dark'}
    options={{ readOnly: true, domReadOnly: true, minimap: { enabled: false }, fontSize: 12, wordWrap: 'on', automaticLayout: true, scrollBeyondLastLine: false }} /></div>
}
