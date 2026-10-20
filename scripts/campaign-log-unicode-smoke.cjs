// Actual scheduler + managed result writer + local PostgreSQL WASM.
// No live database access, browser actions or customer identifiers.
const assert = require('node:assert/strict')
const { toUSVString } = require('node:util')
const { harness, result, step } = require('./action-status-mixed-output-smoke.cjs')

const fire = '\u{1F525}'
const signal = '\u{1F4F6}'
const templates = [
  `${fire} LẮP MẠNG FPT – TẶNG CAMERA 400K\n• ${signal} Internet tốc độ cao – ổn định`,
  `\n${fire} LẮP MẠNG FPT CHỈ TỪ 230K/THÁNG – TẶNG CAMERA TRỊ GIÁ 400K\n• ${signal} Internet tốc độ cao`,
  `\n${fire} LẮP INTERNET FPT – NHẬN ƯU ĐÃI CAMERA 400K\n• ${signal} Internet tốc độ cao, kết nối ổn định`
]
let checks = 0

async function previewCases(zca) {
  const f = await harness(zca, 'facebook_comment_seeding')
  try {
    const oldPreview = templates[2].substring(0, 50) + '...'
    assert.notEqual(oldPreview, toUSVString(oldPreview), 'incident fixture must reproduce the broken surrogate')
    await assert.rejects(f.db.query('SELECT $1::jsonb', [JSON.stringify({ log: oldPreview })]),
      error => error.code === '22P02' && /invalid input syntax for type json/i.test(error.message))
    checks++

    const cases = [
      ['', ''],
      ['Xin chào', 'Xin chào'],
      ['a'.repeat(50), 'a'.repeat(50)],
      ['a'.repeat(51), 'a'.repeat(50) + '...'],
      ['a'.repeat(49) + signal, 'a'.repeat(49) + '...'],
      ['a'.repeat(48) + signal, 'a'.repeat(48) + signal],
      ['a'.repeat(48) + signal + 'b', 'a'.repeat(48) + signal + '...'],
      ['a'.repeat(50) + signal, 'a'.repeat(50) + '...'],
      [signal.repeat(26), signal.repeat(25) + '...'],
      ['a'.repeat(49) + '\u{20000}', 'a'.repeat(49) + '...'],
      [templates[0], templates[0].substring(0, 50) + '...'],
      [templates[1], templates[1].substring(0, 50) + '...'],
      [templates[2], `\n${fire} LẮP INTERNET FPT – NHẬN ƯU ĐÃI CAMERA 400K\n• ...`]
    ]
    for (const [content, expected] of cases) {
      const preview = f.scheduler.getCampaignLogContentPreview(content)
      assert.equal(preview, expected)
      assert.equal(preview, toUSVString(preview), 'preview must be well-formed Unicode')
      const { rows } = await f.db.query('SELECT $1::jsonb AS payload', [JSON.stringify({ log: preview })])
      assert.equal(rows[0].payload.log, expected, 'PostgreSQL must accept the serialized preview unchanged')
      checks++
    }
  } finally { await f.close() }
}

async function commentCases(zca) {
  for (const actionId of ['facebook_comment_seeding', 'facebook_comment_seeding_post', 'facebook_group_post']) {
    for (const problemIndex of [0, 1, 2]) {
      const f = await harness(zca, actionId)
      try {
        const contents = templates.slice(0, 2)
        contents.splice(problemIndex, 0, templates[2])
        const steps = contents.map((text, index) => step(index + 1,
          actionId === 'facebook_comment_seeding' ? 'fb_comment_at_position' : 'fb_comment_current_post',
          { text, position: index + 1, commented: true, imageCount: 0,
            commentUrl: `https://www.facebook.com/groups/1/posts/2/?comment_id=${index + 1}` }))
        const summary = await f.final(steps)
        await f.finish()
        const rows = await f.details()
        assert.equal(summary.hasSuccess, true)
        assert.equal(rows.length, 3, 'all three results must persist even when the affected template comes first')
        assert.equal(await f.quota(), 3, 'each successful comment counts once')
        for (const [index, row] of rows.entries()) {
          assert.equal(row.data.commentContent, contents[index], 'full submitted text must stay unchanged')
          assert.equal(row.data.commentUrl, steps[index].output.commentUrl, 'keep the exact comment link')
          assert.equal(f.writes[index].postUrl, steps[index].output.commentUrl)
          assert.equal(row.log, toUSVString(row.log))
          assert.equal(row.status, 'thành công')
          assert.equal(row.data.iteration, index + 1)
        }
        assert.equal((await f.db.query('SELECT status FROM auto_campaign_input_data WHERE id=1')).rows[0].status, 'hoàn thành')
        checks++
      } finally { await f.close() }
    }
  }
}

async function newsfeedCases(zca) {
  for (const kind of ['like', 'comment']) for (const explicit of [false, true]) {
    const f = await harness(zca)
    try {
      // Newsfeed trims leading whitespace before previewing, so place the
      // surrogate pair across its own cutoff instead of relying on the newline.
      const content = 'a'.repeat(49) + signal + ' nội dung đầy đủ'
      const actionCode = kind === 'like' ? 'fb_like_post' : 'fb_comment'
      const s = step(1, kind === 'like' ? 'fb_newsfeed_like_post' : 'fb_newsfeed_comment_submit', {
        [kind === 'like' ? 'liked' : 'commented']: true,
        targetName: 'Fixture', postContent: content, text: content,
        ...(explicit ? { actionResult: result(actionCode) } : {})
      })
      await f.realtime(s)
      await f.final([structuredClone(s)])
      await f.finish()
      const rows = await f.details()
      assert.equal(rows.length, 1, 'realtime and finalization must share the same receipt')
      assert.equal(await f.quota(), 1)
      assert.equal(rows[0].log, toUSVString(rows[0].log))
      assert.equal(rows[0].data.postContent, content)
      if (kind === 'comment') assert.equal(rows[0].data.commentContent, content)
      checks++
    } finally { await f.close() }
  }
}

async function main() {
  const zca = await import('zca-js')
  await previewCases(zca)
  await commentCases(zca)
  await newsfeedCases(zca)
  console.log(JSON.stringify({ checks, external_operations: 0 }))
}
main().catch(error => { console.error(error); process.exitCode = 1 })
