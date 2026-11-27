// Đọc các câu chữ của src/shared/campaignScheduleEnd.ts cho bài kiểm chạy bằng Node (không cần trình dịch TypeScript).
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const source = readFileSync(join(__dirname, '..', 'src', 'shared', 'campaignScheduleEnd.ts'), 'utf8')
const texts = {}
for (const match of source.matchAll(/export const (SCHEDULE_END_[A-Z_]+) =\s*\n?\s*'((?:[^'\\]|\\.)*)'/g)) texts[match[1]] = match[2].replace(/\\'/g, "'")
module.exports = texts
