// App tsconfigs exclude Edge Functions. Check the issuer against its exact SDK
// using the local TypeScript compiler; this does not replace Deno deployment QA.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const handler = path.resolve(__dirname, '../../supabase/functions/aka-agent-desktop-session/handler.ts')
const version = require('@supabase/supabase-js/package.json').version
const importedVersion = fs.readFileSync(handler, 'utf8').match(/npm:@supabase\/supabase-js@([^']+)/)?.[1]
assert.equal(version, importedVersion, 'Install the exact Edge SDK before checking its types')
const options = {
  noEmit: true, strict: true, target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'], skipLibCheck: true
}
const host = ts.createCompilerHost(options)
host.resolveModuleNames = (names, file) => names.map(name =>
  ts.resolveModuleName(name === `npm:@supabase/supabase-js@${version}` ? '@supabase/supabase-js' : name,
    file, options, host).resolvedModule)
const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([handler], options, host))
if (diagnostics.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCurrentDirectory: () => process.cwd(), getCanonicalFileName: file => file, getNewLine: () => '\n'
  }))
  process.exitCode = 1
} else console.log(`PASS Edge handler strict typecheck against Supabase SDK ${version}`)
