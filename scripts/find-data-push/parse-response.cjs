// Đọc kết quả aka_agent_find_data_push_v1 bằng đúng parseFindDataPushResponse của app (src/shared/findDataPush.ts).
const { createLoader, root } = require('./load-scheduler.cjs')
const path = require('node:path')

const shared = createLoader()(path.join(root, 'src/shared/findDataPush.ts'))
module.exports = raw => {
  const parsed = shared.parseFindDataPushResponse(raw)
  if (!parsed) throw new Error('Kết quả đẩy data không hợp lệ')
  return parsed
}
