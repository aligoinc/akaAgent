/// <reference types="vite/client" />
import * as monaco from 'monaco-editor'
import 'monaco-editor/esm/vs/language/typescript/monaco.contribution'
import { loader } from '@monaco-editor/react'
// Vite worker imports — `?worker` syntax declared bởi vite/client.d.ts (đã reference ở trên)
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import { BLOCK_API_DTS } from './blockApiTypes'

// Configure Monaco workers cho Vite (worker từ ESM)
;(self as any).MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === 'json') return new jsonWorker()
    if (label === 'typescript' || label === 'javascript') return new tsWorker()
    return new editorWorker()
  }
}

// Make @monaco-editor/react dùng instance bundled local thay vì CDN
loader.config({ monaco })

let _initialized = false
export function initMonaco(): void {
  if (_initialized) return
  _initialized = true

  // monaco-editor 0.55+ marked languages.typescript as `{ deprecated: true }` ở
  // type level. Runtime API vẫn đầy đủ — cast sang any để dùng.
  const tsLang = (monaco.languages as any).typescript
  if (!tsLang || !tsLang.javascriptDefaults) {
    console.warn('[monacoSetup] languages.typescript not available — JS intellisense disabled')
    return
  }

  tsLang.javascriptDefaults.setCompilerOptions({
    target: tsLang.ScriptTarget.ES2020,
    allowNonTsExtensions: true,
    moduleResolution: tsLang.ModuleResolutionKind.NodeJs,
    module: tsLang.ModuleKind.ESNext,
    noEmit: true,
    esModuleInterop: true,
    allowJs: true,
    strict: false,
    noLib: false
  })

  tsLang.javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
    diagnosticCodesToIgnore: [
      1108, // 'A return statement can only be used within a function body'
      1375, // 'await expression only at top level'
      1378
    ]
  })

  tsLang.javascriptDefaults.addExtraLib(BLOCK_API_DTS, 'file:///block-api.d.ts')
}
