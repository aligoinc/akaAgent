import { spawn } from 'node:child_process'

export interface SqliteFilterPage { rows: Record<string, unknown>[]; total: number }
// SQLite executes native synchronous calls. A killable process, rather than a
// JS timeout around that call, provides an actual execution deadline.
const readerSource = `
let input=''; process.stdin.setEncoding('utf8');
process.stdin.on('data',chunk=>{input+=chunk;if(input.length>2097152)process.exit(2)});
process.stdin.on('end',()=>{
 let db;
 try {
  const work=JSON.parse(input),Database=require(work.driver);
  db=new Database(work.path,{readonly:true,fileMustExist:true,timeout:250});
  db.function('column_filter_fold',{deterministic:true},v=>v==null?null:String(v).normalize('NFC').toLocaleLowerCase('vi-VN'));
  const result=db.transaction(()=>{
   const total=db.prepare('SELECT COUNT(*) AS total FROM auto_account_contacts '+work.where).get(...work.params).total;
   const rows=db.prepare("SELECT * FROM auto_account_contacts "+work.where+" ORDER BY datetime(COALESCE(json_extract(extra_data, '$.lastMessageAt'), updated_at)) DESC, id DESC LIMIT ? OFFSET ?").all(...work.params,work.limit,work.offset);
   return {rows,total};
  })();
  process.stdout.write(JSON.stringify({result}));
 } catch(error) {process.stdout.write(JSON.stringify({error:error.message}));process.exitCode=1}
 finally {if(db)db.close()}
});
`
export async function readSqliteFilterPage(
  path: string, where: string, params: unknown[], limit: number, offset: number, signal: AbortSignal,
  deadlineMs = 3000
): Promise<SqliteFilterPage> {
  if (signal.aborted) throw new Error('Đã hủy lượt lọc dữ liệu.')
  if (!Number.isInteger(limit) || limit < 1 || limit > 500 || !Number.isInteger(offset) || offset < 0) throw new Error('Phân trang bộ lọc không hợp lệ.')
  const child = spawn(process.execPath, ['-e', readerSource], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true
  })
  const closed = new Promise<void>(resolve => child.once('close', () => resolve()))
  try {
    return await new Promise<SqliteFilterPage>((resolve, reject) => {
      let settled = false, output = ''
      const finish = (error?: Error, result?: SqliteFilterPage): void => {
        if (settled) return
        settled = true; clearTimeout(timer); signal.removeEventListener('abort', onAbort)
        if (error) reject(error); else resolve(result!)
      }
      const onAbort = (): void => finish(new Error('Đã hủy lượt lọc dữ liệu.'))
      const timer = setTimeout(() => finish(new Error('Truy vấn lọc quá thời gian cho phép. Hãy thu hẹp điều kiện rồi thử lại.')), deadlineMs)
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) onAbort()
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', chunk => {
        output += chunk
        if (Buffer.byteLength(output) > 16 * 1024 * 1024) finish(new Error('Trang dữ liệu quá lớn. Hãy giảm số dòng mỗi trang.'))
      })
      child.stderr.resume() // Do not forward native paths or row content to the renderer.
      child.stdin.once('error', error => finish(error))
      child.once('error', error => finish(error))
      child.once('close', code => {
        if (settled) return
        try {
          const message = JSON.parse(output)
          if (code !== 0 || message.error) return finish(new Error('Không thể đọc dữ liệu Page Inbox. Vui lòng thử lại.'))
          const result = message.result
          if (!result || !Array.isArray(result.rows) || result.rows.length > limit || !Number.isSafeInteger(result.total) || result.total < 0) throw new Error('invalid response')
          finish(undefined, result)
        } catch { finish(new Error('Phản hồi bộ đọc Page Inbox không hợp lệ.')) }
      })
      child.stdin.end(JSON.stringify({ path, where, params, limit, offset, driver: require.resolve('better-sqlite3') }))
    })
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await closed
  }
}
