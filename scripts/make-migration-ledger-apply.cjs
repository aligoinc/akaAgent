// Bọc file migration: chèn dòng sổ migration ngay trước COMMIT cuối, cùng một giao dịch; statements[1] = nguyên văn file.
// Cách đã dùng để apply V495–V500 (12/11/2026): sinh ngay lúc apply (version = giờ UTC lúc sinh), rồi
//   supabase db query --linked --workdir <repo akaAgent> -f <file sinh ra>
// Kiểm sau apply: md5(statements[1]) trong supabase_migrations.schema_migrations = file_md5 in ra ở đây.
// Dùng: node scripts/make-migration-ledger-apply.cjs <file migration> <tên trong sổ> <file ra>
'use strict'
const fs = require('node:fs')
const crypto = require('node:crypto')
const [file, name, out] = process.argv.slice(2)
const text = fs.readFileSync(file, 'utf8')
const idx = text.lastIndexOf('COMMIT;')
if (idx < 0 || text.slice(idx).trim() !== 'COMMIT;') throw new Error('file phải kết thúc bằng COMMIT;')
const tag = '$ledger_' + crypto.randomBytes(6).toString('hex') + '$'
if (text.includes(tag)) throw new Error('trùng tag')
const d = new Date()
const pad = n => String(n).padStart(2, '0')
const version = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
const ledger = `INSERT INTO supabase_migrations.schema_migrations (version, name, statements)\nVALUES ('${version}', '${name}', ARRAY[${tag}${text}${tag}]);\n`
fs.writeFileSync(out, text.slice(0, idx) + ledger + text.slice(idx))
console.log(JSON.stringify({ version, name, file_md5: crypto.createHash('md5').update(text).digest('hex') }))
