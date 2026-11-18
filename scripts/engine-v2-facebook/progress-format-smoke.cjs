// Tiến trình và mã lỗi engine v2 như bộ cũ (anh chốt 18/11/2026, docs/ENGINE_V2_FACEBOOK_PROGRESS_PARITY.md), phần không cần DB:
//   node scripts/engine-v2-facebook/progress-format-smoke.cjs
// Dòng lỗi "<emoji> <thao tác> "<data>": <câu> (mã)" (mục 9), câu kết thúc của "chạy lại sau N giờ" đúng chữ bộ cũ (mục 2), "ℹ️ Bỏ qua"
// (mục 5), dấu hiệu FB41 / FB46 của V575 và câu FB41 bỏ XPath (mục 7a, 7b), mã lỗi tệp theo nguyên nhân CFG20 / CFG01 (mục 7c).
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { pathToFileURL } = require('node:url')
const { build } = require('esbuild')
const V575 = require('../build-v575-sql.cjs')

const ROOT = path.resolve(__dirname, '../..')
let passed = 0
let failed = 0
async function check(name, fn) {
  try { await fn(); passed++; console.log(`PASS ${name}`) } catch (error) { failed++; console.log(`FAIL ${name}: ${error.stack || error.message}`) }
}

async function loadEngine() {
  const cache = path.join(ROOT, 'node_modules', '.cache')
  fs.mkdirSync(cache, { recursive: true })
  const out = fs.mkdtempSync(path.join(cache, 'aka-engine-progress-'))
  const tsc = require.resolve('typescript/bin/tsc', { paths: [ROOT] })
  const r = spawnSync(process.execPath, [tsc, '-p', path.join(ROOT, 'packages/campaign-engine/tsconfig.json'), '--outDir', out], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error('tsc: ' + (r.stdout || r.stderr))
  fs.writeFileSync(path.join(out, 'package.json'), '{"type":"module"}')
  return import(pathToFileURL(path.join(out, 'index.js')).href)
}

/** Bản dựng CommonJS của một module TS trong src/main (không Electron). */
async function loadMain(relative, dir) {
  const outfile = path.join(dir, path.basename(relative).replace(/\.ts$/, '.cjs'))
  await build({ entryPoints: [path.join(ROOT, relative)], outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'error' })
  return require(outfile)
}

const decision = over => ({ resultKey: 'v2:1:x', actionCode: 'zalo_message_stranger', actionName: 'Nhắn tin người lạ', ok: false, errorCode: 'err_x',
  publicCode: 'Z122', errorClass: 'target_permanent', statusId: 22, statusCode: 'campaign_detail_failed', reportGroup: 'failure',
  deliveryState: 'not_delivered', countsTowardLimit: false, detailId: 10, log: 'Người nhận chặn tin nhắn từ người lạ', lockUntil: null, ...over })

async function main() {
  const E = await loadEngine()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-progress-format-'))
  try {
    const signs = await loadMain('src/main/engineAdapters/facebook/errorSigns.ts', dir)
    const media = await loadMain('src/main/services/campaignMediaSource.ts', dir)
    const scheduler = fs.readFileSync(path.join(ROOT, 'src/main/services/campaignScheduler.ts'), 'utf8')

    await check('mục 9: tên data chèn đúng chỗ, câu đã có tên thì không lặp, không có thao tác / câu thì vẫn đọc được', async () => {
      const f = E.formatTargetActionLog
      assert.equal(f('Nhắn tin người lạ', '0912 345 678', 'Người nhận chặn tin nhắn từ người lạ (Z122)'),
        'Nhắn tin người lạ "0912 345 678": Người nhận chặn tin nhắn từ người lạ (Z122)')
      assert.equal(f('Đăng bài group', 'Chợ Nha Trang', 'Đăng bài group: Kết nối mạng tạm thời gián đoạn (NET01)'),
        'Đăng bài group "Chợ Nha Trang": Kết nối mạng tạm thời gián đoạn (NET01)')
      assert.equal(f('Nhắn tin người lạ', 'Khánh', 'Nhắn tin người lạ thất bại: read ECONNRESET (Z999)'),
        'Nhắn tin người lạ "Khánh" thất bại: read ECONNRESET (Z999)')
      assert.equal(f('Comment', 'Nhóm 1', 'Không comment được bài thứ 2 tại Nhóm 1: không thấy ô bình luận (FB41)'),
        'Comment: Không comment được bài thứ 2 tại Nhóm 1: không thấy ô bình luận (FB41)', 'câu đã có tên data')
      assert.equal(f('Comment', 'N/A', 'Lỗi (SYS99)'), 'Comment: Lỗi (SYS99)')
      assert.equal(f('', 'Nhóm 1', 'Có lỗi xảy ra (SYS99)'), '"Nhóm 1": Có lỗi xảy ra (SYS99)')
      assert.equal(f('Comment', 'Nhóm 1', ''), 'Comment "Nhóm 1"')
      assert.equal(f('Comment', 'Nhóm 1', 'Commented sai'), 'Commented sai', 'chữ dính liền tên thao tác thì không chèn')
    })

    await check('mục 9: ❌ data đã đóng mà không thành công, ⚠️ về hàng đợi / không rõ đã gửi; dòng thành công giữ như cũ', async () => {
      const ctx = { actionName: 'Nhắn tin người lạ', targetLabel: '0912 345 678' }
      const out = d => { const l = E.outcomeProgress(7, 3, decision(d), ctx); return l && [l.text, l.level] }
      assert.deepEqual(out({}), ['❌ Nhắn tin người lạ "0912 345 678": Người nhận chặn tin nhắn từ người lạ (Z122)', 'error'])
      assert.deepEqual(out({ detailId: null, publicCode: 'NET01', log: 'Kết nối mạng tạm thời gián đoạn' }),
        ['⚠️ Nhắn tin người lạ "0912 345 678": Kết nối mạng tạm thời gián đoạn (NET01)', 'warning'])
      assert.deepEqual(out({ deliveryState: 'unknown', publicCode: 'UNK01', log: 'Không xác nhận được tin đã tới; không gửi lại để tránh trùng' }),
        ['⚠️ Nhắn tin người lạ "0912 345 678": Không xác nhận được tin đã tới; không gửi lại để tránh trùng (UNK01)', 'warning'])
      assert.deepEqual(out({ deliveryState: 'partial', publicCode: 'Z112', log: 'Nội dung quá dài' }),
        ['⚠️ Nhắn tin người lạ "0912 345 678": Nội dung quá dài (Z112)', 'error'])
      // "Đã làm từ trước" (bỏ qua, không phải lỗi của data) và kết quả thành công kèm mã: không emoji, như bộ cũ.
      assert.deepEqual(out({ reportGroup: 'skipped', errorClass: 'already_done', publicCode: 'Z225', log: 'Đã là bạn bè', actionName: 'Kết bạn' }),
        ['Kết bạn: Đã là bạn bè (Z225)', 'info'])
      // Bỏ qua vì lỗi của data (FB40 không thấy ô đăng bài, lớp target_permanent): vẫn là dòng lỗi như bộ cũ Facebook.
      assert.deepEqual(out({ reportGroup: 'skipped', publicCode: 'FB40', log: 'Không thấy ô đăng bài trong nhóm', actionName: 'Đăng bài group' }),
        ['❌ Đăng bài group "0912 345 678": Không thấy ô đăng bài trong nhóm (FB40)', 'error'])
      assert.deepEqual(out({ ok: true, errorCode: null, publicCode: null, log: 'Đã gửi tin nhắn đến An', reportGroup: 'success' }),
        ['Nhắn tin người lạ: Đã gửi tin nhắn đến An', 'success'])
      assert.equal(E.outcomeProgress(7, 3, decision({ errorCode: E.NO_HISTORY_ERROR_CODE }), ctx), null, 'FB45 không in gì')
    })

    await check('mục 2: câu kết thúc của "chạy lại sau N giờ" đúng chữ bộ cũ (handleRerunAfterCompletion)', async () => {
      const iso = '2026-11-18T09:30:00.000Z'
      const text = finished => E.finishProgress(9, 'Lướt nhóm', finished, 'desktop')?.text
      const cases = [
        [{ reason: 'completed_rerun_next_day' }, '✅ Hoàn thành chiến dịch "Lướt nhóm" (không hẹn chạy lại theo giờ qua ngày mới)',
          '`✅ Hoàn thành chiến dịch "${campaign.name}" (không hẹn chạy lại theo giờ qua ngày mới)`'],
        [{ reason: 'completed_rerun_after_cutoff', hours: 3 }, '✅ Hoàn thành chiến dịch "Lướt nhóm" (lượt chạy lại sau 3 giờ vượt quá giờ dừng trong ngày)',
          '`✅ Hoàn thành chiến dịch "${campaign.name}" (lượt chạy lại sau ${hours} giờ vượt quá giờ dừng trong ngày)`'],
        [{ reason: 'completed_rerun_no_data' }, '✅ Hoàn thành chiến dịch "Lướt nhóm" (không có data cần chạy lại)',
          '`✅ Hoàn thành chiến dịch "${campaign.name}" (không có data cần chạy lại)`'],
        [{ reason: 'completed_no_rerun_page', suffix: 'trong nhóm data' }, '✅ Hoàn thành chiến dịch "Lướt nhóm" (không có page cần chạy lại trong nhóm data)',
          '`✅ Hoàn thành chiến dịch "${campaign.name}" (không có page cần chạy lại ${labels.emptyDataSuffix})`'],
        [{ reason: 'rerun_scheduled', schedule: iso, hours: 2 }, `⏳ Đã hoàn thành lượt chạy và hẹn chạy lại chiến dịch "Lướt nhóm" lúc ${E.formatVietnamDateTime(iso)}`,
          '`⏳ Đã hoàn thành lượt chạy và hẹn chạy lại chiến dịch "${campaign.name}" lúc ${this.formatVietnamDateTime(nextSchedule)}`']
      ]
      for (const [finished, expected, legacy] of cases) {
        assert.equal(text(finished), expected, finished.reason)
        assert.ok(scheduler.includes(legacy), `bộ cũ còn đúng câu: ${legacy}`)
      }
    })

    await check('mục 5: "ℹ️ Bỏ qua" như executeCampaignV2 của bộ cũ', async () => {
      const l = E.targetSkippedProgress(9, 4, 'Nhóm 1', 'Bài viết gốc không cho phép chia sẻ vào nhóm')
      assert.deepEqual([l.text, l.level, l.inputDataId], ['ℹ️ Bỏ qua "Nhóm 1": Bài viết gốc không cho phép chia sẻ vào nhóm', 'info', 4])
      assert.ok(scheduler.includes('`ℹ️ Bỏ qua "${this.getInputDataDisplayName(campaign, detail)}": ${skippedNote}`'))
    })

    await check('mục 7a / 7b: dấu hiệu V575 gắn FB41 cho dòng comment chưa có mã, FB46 thay err_undefined ở hộp thư Page; câu FB41 bỏ XPath', async () => {
      const list = signs.parseFacebookErrorSigns(V575.SIGNS_AFTER_JSON)
      assert.equal(list.length, 7)
      const comment = 'Không comment được bài thứ 5: waitForSelector timeout: (//div[@aria-label=\'Viết bình luận...\' or contains(@aria-label,\'Comment\')])'
      const pick = (actionCode, currentErrorCode, message, phase = 'after_send') =>
        signs.pickFacebookErrorSign(list, { actionCode, phase, currentErrorCode }, { messages: [message] })?.code ?? null
      assert.equal(pick('fb_comment', null, comment), 'err_fb_comment_box_not_found')
      assert.equal(pick('fb_comment', null, comment, 'before_send'), 'err_fb_comment_box_not_found')
      assert.equal(pick('fb_comment', 'err_comment_frequency_limit', comment), null, 'mã đang có không bị thay')
      assert.equal(pick('fb_post_group', null, 'waitForSelector timeout: //div'), null, 'chỉ dòng comment')
      assert.equal(pick('fb_message_page_inbox_customer', 'err_undefined', 'Lỗi nhắn tin khách inbox page đến A: Không tìm thấy ô để nhập tin nhắn'),
        'err_fb_page_inbox_message_box_not_found')
      assert.equal(pick('fb_message_page_inbox_customer', null, 'Không tìm thấy khách hàng trong inbox page'), 'err_fb_page_inbox_customer_not_found',
        'dấu hiệu cũ giữ nguyên')
      assert.equal(signs.rewriteFacebookSignMessage('err_fb_comment_box_not_found', comment), 'Không comment được bài thứ 5: không thấy ô bình luận')
      assert.equal(signs.rewriteFacebookSignMessage('err_fb_comment_box_not_found', 'Không comment được bài của mình: waitForSelector timeout: //x'),
        'Không comment được bài của mình: không thấy ô bình luận')
      assert.equal(signs.rewriteFacebookSignMessage('err_fb_page_inbox_message_box_not_found', 'giữ nguyên'), 'giữ nguyên')
    })

    await check('mục 7c: lỗi tệp mang nguyên nhân (không còn trên máy → CFG20, tải không được / không có nguồn → CFG01), câu lỗi giữ như bộ cũ', async () => {
      const failOf = async item => {
        try { await media.resolveCampaignMediaSource(item, []); return null } catch (error) { return error }
      }
      const missing = path.join(dir, 'khong-co', 'a.jpg')
      const local = await failOf({ name: 'a.jpg', localPath: missing })
      assert.ok(media.isCampaignMediaResolveError(local))
      assert.equal(local.message, 'Không dùng được media "a.jpg": local path không tồn tại và không có cloud URL fallback')
      assert.equal(local.failure, 'local_missing')
      assert.equal(media.campaignMediaErrorCode(local), 'err_media_local_file_missing')
      const legacyString = await failOf(missing)
      assert.equal(legacyString.failure, 'local_missing')
      const cloud = await failOf({ name: 'b.jpg', localPath: missing, cloudUrl: 'http://127.0.0.1:9/b.jpg' })
      assert.match(cloud.message, /^Không dùng được media "b\.jpg": local path không tồn tại và cloud URL không tải được \(/)
      assert.equal(cloud.failure, 'download_failed')
      assert.equal(media.campaignMediaErrorCode(cloud), 'err_media_file_missing')
      const none = await failOf({ name: 'c.jpg' })
      assert.equal(none.failure, 'no_source')
      assert.equal(media.campaignMediaErrorCode(none), 'err_media_file_missing')
      const exists = path.join(dir, 'co.jpg')
      fs.writeFileSync(exists, 'x')
      assert.equal(await media.resolveCampaignMediaSource({ name: 'co.jpg', localPath: exists }, []), exists)
      // Lõi (Zalo, cả Fly): mặc định CFG01, nơi chạy truyền CFG20 khi biết tệp chỉ có trên máy.
      assert.equal(E.mediaUnavailableError('x').signal.errorCode, 'err_media_file_missing')
      assert.equal(E.mediaUnavailableError('x', 'err_media_local_file_missing').signal.errorCode, 'err_media_local_file_missing')
    })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
  console.log(`\n${passed} PASS, ${failed} FAIL`)
  process.exit(failed ? 1 : 0)
}

main().catch(error => { console.error(error); process.exit(1) })
