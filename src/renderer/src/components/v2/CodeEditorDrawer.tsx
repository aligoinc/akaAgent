import { useEffect, useState, useMemo } from 'react'
import Editor from '@monaco-editor/react'
import { initMonaco } from '../../lib/monacoSetup'
import { Save, X } from 'lucide-react'

interface Props {
  open: boolean
  title: string
  initialCode: string
  /** Hint cho code editor: hiển thị API spec */
  hint?: string
  onClose: () => void
  onSave: (code: string) => void
  /** Cho phép xóa code (set undefined) — dùng cho codeOverride trên instance */
  onClear?: () => void
}

export default function CodeEditorDrawer({ open, title, initialCode, hint, onClose, onSave, onClear }: Props) {
  const [code, setCode] = useState(initialCode)

  useEffect(() => {
    if (open) {
      initMonaco()
      setCode(initialCode)
    }
  }, [open, initialCode])

  const editorOptions = useMemo(() => ({
    minimap: { enabled: false },
    fontSize: 13,
    tabSize: 2,
    lineNumbers: 'on' as const,
    scrollBeyondLastLine: false,
    wordWrap: 'on' as const
  }), [])

  if (!open) return null

  return (
    <div style={{
      position: 'fixed',
      // Top: 36px chừa chỗ Electron titleBarOverlay (Windows controls + TopBar branding)
      top: 36, right: 0, bottom: 0,
      width: '60vw', maxWidth: 900, minWidth: 480,
      background: 'var(--bg-secondary, #16161e)',
      borderLeft: '1px solid var(--border, #2a2a35)',
      borderTop: '1px solid var(--border, #2a2a35)',
      boxShadow: '-4px 0 16px rgba(0, 0, 0, 0.4)',
      zIndex: 1000, display: 'flex', flexDirection: 'column'
    }}>
      {/* Header padding-right chừa Windows native controls */}
      <div style={{
        padding: '8px 150px 8px 12px',
        borderBottom: '1px solid var(--border, #2a2a35)',
        display: 'flex', alignItems: 'center', gap: 8,
        WebkitAppRegion: 'no-drag'
      } as React.CSSProperties}>
        <div style={{ flex: 1, fontSize: 13, fontWeight: 500, color: 'var(--text, #e0e0e0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
        {onClear && (
          <button className="btn btn-sm btn-ghost" onClick={onClear} title="Xoá override, dùng code mặc định của block">
            Reset
          </button>
        )}
        <button className="btn btn-sm" onClick={() => onSave(code)}><Save size={13} /> Lưu</button>
        <button className="btn btn-sm btn-ghost" onClick={onClose} title="Đóng"><X size={13} /> Đóng</button>
      </div>

      {/* Hint */}
      {hint && (
        <div style={{
          padding: '6px 12px', fontSize: 11, color: '#999',
          background: 'var(--bg-primary, #0e0e15)',
          borderBottom: '1px solid var(--border, #2a2a35)',
          fontFamily: 'monospace', whiteSpace: 'pre-wrap'
        }}>
          {hint}
        </div>
      )}

      {/* Monaco */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <Editor
          language="javascript"
          theme="vs-dark"
          value={code}
          onChange={(v) => setCode(v ?? '')}
          options={editorOptions}
        />
      </div>
    </div>
  )
}
