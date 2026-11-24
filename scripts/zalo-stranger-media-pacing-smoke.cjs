#!/usr/bin/env node
// Kiểm hàm cảnh báo "từ 3 ảnh thì nghỉ từ 300 giây" của form chiến dịch (src/shared/zaloStrangerMediaPacing.ts, V647).
'use strict'
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const esbuild = require('esbuild')

const src = fs.readFileSync(path.join(__dirname, '../src/shared/zaloStrangerMediaPacing.ts'), 'utf8')
const { code } = esbuild.transformSync(src, { loader: 'ts', format: 'cjs' })
const mod = { exports: {} }
new Function('module', 'exports', code)(mod, mod.exports)
const { shouldWarnZaloStrangerMediaPacing: warn, maxZaloFilesPerMessage: max } = mod.exports

const imgs = n => Array.from({ length: n }, (_, i) => ({ cloudUrl: `https://x/${i}.jpg` }))
const base = { actionId: 'zalo_message_phone', sleepSeconds: 30, imageOption: 'all', images: imgs(3) }
let n = 0
const ok = (cond, name) => { assert.ok(cond, name); n++ }

ok(warn(base), '3 ảnh, 30 giây: cảnh báo')
ok(!warn({ ...base, images: imgs(2) }), '2 ảnh: không')
ok(!warn({ ...base, sleepSeconds: 300 }), '300 giây: không')
ok(warn({ ...base, sleepSeconds: 299 }), '299 giây: có')
ok(!warn({ ...base, imageOption: 'none' }), 'không gửi ảnh: không')
ok(!warn({ ...base, imageOption: 'random', randomImageCount: 2, images: imgs(10) }), 'ngẫu nhiên 2/10: không')
ok(warn({ ...base, imageOption: 'random', randomImageCount: 3, images: imgs(10) }), 'ngẫu nhiên 3/10: có')
ok(warn({ ...base, imageOption: 'random', randomImageCount: 0, images: imgs(10) }), 'ngẫu nhiên không đặt số = 3 như bộ chạy: có')
ok(!warn({ ...base, actionId: 'zalo_message_friend' }), 'nhắn bạn bè: không')
ok(!warn({ ...base, actionId: 'zalo_message_group' }), 'nhắn group: không')
for (const id of ['zalo_message_group_member', 'zalo_message_group_realtime', 'zalo_message_remarketing_customer', 'zalo_message_friend_recommendation'])
  ok(warn({ ...base, actionId: id }), id)
const adv = { ...base, images: [], advancedContentEnabled: true }
ok(!warn({ ...adv, advancedContentItems: [{ mediaOption: 'all', mediaItems: imgs(2) }, { mediaOption: 'none', mediaItems: imgs(5) }] }), 'nâng cao: mục lớn nhất 2')
ok(warn({ ...adv, advancedContentItems: [{ mediaOption: 'all', mediaItems: imgs(1) }, { mediaOption: 'all', mediaItems: imgs(4) }] }), 'nâng cao: một mục 4 ảnh')
ok(!warn({ ...adv, advancedContentItems: [{ mediaOption: 'random', randomMediaCount: 1, mediaItems: imgs(6) }] }), 'nâng cao: ngẫu nhiên 1')
ok(max({ ...base, images: imgs(7) }) === 7, 'đếm tệp')
console.log(`PASS: ${n} ca`)
