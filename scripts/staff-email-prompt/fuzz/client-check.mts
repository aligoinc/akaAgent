// Đọc danh sách chuỗi (stdin JSON), trả về kết quả của đúng hàm phía giao diện (src/shared/emailPrompt.ts).
// Chế độ 'validate': normalizeEmail / isValidEmail / suggestEmailFix. Chế độ 'parse': chạy parseEmailPrompt* trên kết quả RPC.
import * as ep from '../../../src/shared/emailPrompt.ts'
const mode = process.argv[2]
const input = JSON.parse(await new Promise<string>(r => { let s = ''; process.stdin.on('data', d => (s += d)); process.stdin.on('end', () => r(s)) }))
if (mode === 'validate') {
  const out = (input as string[]).map(raw => {
    const sent = ep.normalizeEmail(raw)
    return { raw, sent, valid: ep.isValidEmail(raw), fix: ep.suggestEmailFix(raw) }
  })
  process.stdout.write(JSON.stringify(out))
} else {
  const P: Record<string, (x: unknown) => unknown> = {
    state: ep.parseEmailPromptState, save: ep.parseEmailPromptSave, profile: ep.parseEmailPromptProfile, dismiss: ep.parseEmailPromptDismiss
  }
  const out = (input as { action: string; raw: Record<string, unknown> }[]).map(x => ({ ...x, parsed: P[x.action](x.raw) }))
  process.stdout.write(JSON.stringify(out))
}
