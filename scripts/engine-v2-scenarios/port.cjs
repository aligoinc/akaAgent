// Cổng Zalo giả của bộ kịch bản engine v2: cài đủ ZaloCampaignPort (mọi loại chiến dịch) cộng phần cấp chiến dịch (chia sẻ, lấy
// data đầu lượt). Kết quả theo mô hình của world.cjs; mọi lần giao tới người nhận được ghi vào log.sends để kiểm không gửi trùng.
'use strict'
const crypto = require('node:crypto')
const W = require('./world.cjs')

const MESSAGE_ACTION = {
  zalo_message_friend: 'zalo_message_friend', zalo_message_birthday: 'zalo_message_friend', zalo_message_group: 'zalo_message_group'
}
const messageActionOf = actionId => MESSAGE_ACTION[actionId] ?? 'zalo_message_stranger'
const identOf = target => String(target?.phone || target?.uid || target?.id || '')

/**
 * opts: { E, model, rt, seed, chaos, inject, engineChaos, entry (chiến dịch của thế giới), rpc, log, hooks }
 * - chaos: hệ số nhân tỉ lệ lỗi hạ tầng thật; inject: tỉ lệ lỗi hạ tầng tiêm thêm mỗi lời gọi; engineChaos: { exception, hang, nullMsgId,
 *   ownDbError } là lỗi trong chính cổng (lỗi code, treo, Zalo trả thành công không có msgId, DB của mình lỗi khi lưu danh bạ…).
 * - hooks: { beforeSend(ctx, part) } để kịch bản cố định chen vào (tạm dừng giữa lượt, mất lease, chết tiến trình…).
 */
function makePort(opts) {
  const { E, model, rt, seed, entry, rpc, log } = opts
  const chaos = opts.chaos ?? 1
  const inject = opts.inject ?? 0
  const ec = { exception: 0, hang: 0, nullMsgId: 0, ownDbError: 0, ...(opts.engineChaos || {}) }
  const hooks = opts.hooks || {}
  const campaignId = entry.campaignId
  const accountId = entry.accountId
  const messageAction = messageActionOf(entry.actionId)
  let callSeq = 0
  const nextCallId = () => (log.callSeq = (log.callSeq || 0) + 1)
  const callRandom = () => W.unitRandom(seed, 'call', campaignId, ++callSeq)
  const persona = (ident, key) => W.unitRandom(seed, 'persona', campaignId, ident, key)
  const note = (type, data) => log.events.push({ type, campaignId, ...data })

  /** Lỗi hạ tầng của một lời gọi (thật × chaos, rồi tiêm thêm), hoặc null. */
  const infraError = (action, operation) => {
    if (opts.forceOk) return null
    const m = W.modelFor(model, action, rt)
    if (m.account?.length && callRandom() < m.accountRate) return W.renderError(E, W.weighted(callRandom(), m.account), rt, operation)
    if (m.transient?.length && callRandom() < m.transientRate * chaos) return W.renderError(E, W.weighted(callRandom(), m.transient), rt, operation)
    if (inject > 0 && callRandom() < inject) {
      const list = rt === 'fly' ? W.FLY_INJECT : W.DESKTOP_INJECT
      const e = W.weighted(callRandom(), list)
      return rt === 'fly' ? W.flyCommandError(E, e.code, e.message, operation) : W.renderError(E, e, 'desktop', operation)
    }
    return null
  }
  /** Tính cách của người nhận với thao tác: { ok } hoặc một dòng lỗi của mô hình (cố định theo người nhận). */
  const personaOf = (ident, action) => opts.forceOk ? { ok: true } : W.weighted(persona(ident, action), W.modelFor(model, action, rt).personaEntries)

  /** Lỗi trong chính cổng: ngoại lệ code hoặc treo tới khi lõi cắt (hạn bước). */
  const engineFault = async (ctx, kinds) => {
    if (kinds.includes('exception') && callRandom() < ec.exception) {
      note('inject_exception', { inputDataId: ctx.target?.id })
      throw new TypeError("Cannot read properties of undefined (reading 'uid')")
    }
    if (kinds.includes('hang') && callRandom() < ec.hang) {
      note('inject_hang', { inputDataId: ctx.target?.id })
      await new Promise((_, reject) => ctx.signal.addEventListener('abort', () => reject(ctx.signal.reason ?? new Error('aborted')), { once: true }))
    }
  }

  /** Một lần giao tới người nhận: chạy thao tác, ghi log.sends (đã có thể tới hay chưa) rồi trả / ném như cổng thật. */
  const deliver = async (ctx, part, action, ident, run) => {
    if (hooks.beforeSend) await hooks.beforeSend(ctx, part)
    const rec = { campaignId, inputDataId: Number(ctx.target?.id ?? 0), targetRunId: ctx.targetRunId, part, action, ident, at: Date.now(), callId: nextCallId() }
    try {
      await engineFault(ctx, ['exception', 'hang'])
      const result = await run()
      rec.ok = true; rec.possiblyDelivered = true
      log.sends.push(rec)
      if (hooks.afterSend) await hooks.afterSend(ctx, part, rec)
      return result
    } catch (error) {
      rec.ok = false
      rec.phase = error?.phase ?? (error instanceof E.ZaloPortError ? 'after_send' : 'in_flight')
      // Lỗi không phải câu trả lời "từ chối" rõ ràng của Zalo: có thể đã tới (lõi coi là in_flight / không rõ).
      rec.possiblyDelivered = rec.phase === 'in_flight' || error?.evidence?.deliveryState === 'unknown' || !(error instanceof E.ZaloPortError)
      rec.error = String(error?.signal?.code ?? error?.code ?? error?.message ?? error).slice(0, 80)
      log.sends.push(rec)
      throw error
    }
  }
  /** Thao tác gửi theo mô hình: lỗi hạ tầng, rồi tính cách; thành công thì trả kết quả của onOk. */
  const sendOp = async (ctx, part, action, ident, onOk) => deliver(ctx, part, action, ident, async () => {
    const infra = infraError(action, 'send')
    if (infra) throw infra
    const p = personaOf(ident, action)
    if (!p.ok) {
      if (p.kind === 'label_not_found') return onOk({ labelNotFound: true })
      throw W.renderError(E, p, rt, 'send')
    }
    return onOk({})
  })
  const readOp = async (ctx, action, ident) => {
    const infra = infraError(action, 'read')
    if (infra) throw infra
    const p = personaOf(ident, action)
    if (!p.ok) throw W.renderError(E, p, rt, 'read')
    return true
  }
  const msgId = () => (callRandom() < ec.nullMsgId ? null : 'm' + crypto.randomBytes(6).toString('hex'))
  const ownDb = (what, data) => {
    if (callRandom() < ec.ownDbError) { note('own_db_error', { what, ...data }); throw new Error(`DB lỗi khi ${what}: fetch failed`) }
  }

  // Bạn bè giả của tài khoản (lấy data đầu lượt, danh sách không gửi, cổng loại trừ).
  const universe = W.friendUniverse(entry.sample, W.mulberry32(W.hash32(seed, 'universe', campaignId)), entry.universeSize ?? 18)
  const mat = async (ctx, op, payload = {}) => {
    const r = await rpc('SELECT public.aka_agent_engine_materialize_v1($1, $2, $3, $4::jsonb) AS r', [accountId, ctx.leaseToken, op, JSON.stringify(payload)])
    if (r.ok !== true) throw new E.MaterializeRpcError(r.reason, r.message)
    return r
  }
  const profileOf = (uid, ident) => {
    const g = W.unitRandom(seed, 'profile', campaignId, ident)
    const friend = W.unitRandom(seed, 'friend', campaignId, ident) < 0.12
    return E.normalizeZaloFoundUser({ userId: uid, uid, display_name: W.fakeName(W.mulberry32(W.hash32(seed, ident))), zalo_name: 'Zalo ' + ident.slice(-4),
      gender: g < 0.5 ? 0 : 1, globalId: 'G' + W.hash32(ident), isFr: friend ? 1 : 0, is_friend: friend ? 1 : 0,
      is_requesting: !friend && g > 0.9 ? 1 : 0, is_requested: 0, avatar: 'https://example.test/a.jpg' })
  }

  const port = {
    trace: event => { if (/failed|error/i.test(event.type)) note('trace:' + event.type, { event }) },
    // ---- Tra số / hồ sơ ----
    findUser: async (ctx, phone, reqSrc) => {
      if (hooks.beforeRead) await hooks.beforeRead(ctx, 'find')
      await engineFault(ctx, ['exception', 'hang'])
      await readOp(ctx, 'zalo_find_phone_user', phone)
      // Một phần nhỏ "không tồn tại" là Zalo trả trống, không lỗi (find_user_without_uid).
      if (!opts.forceOk && W.unitRandom(seed, 'empty', campaignId, phone) < 0.02) return null
      const user = profileOf(W.fakeUid(W.mulberry32(W.hash32(seed, 'uid', phone))), phone)
      return { ...user, phone, raw: { ...user.raw, phoneNumber: phone, reqSrc } }
    },
    phoneSearchLimitScope: async code => ({ 221: 'hour', 312: 'hour', 313: 'day', 304: 'day' })[code] ?? null,
    saveFoundUser: async ctx => { ownDb('lưu danh bạ', { inputDataId: ctx.target.id }); note('save_found_user', { inputDataId: ctx.target.id }) },
    getUserProfile: async (ctx, uid) => {
      const ident = String(uid)
      const r = opts.forceOk ? 1 : W.unitRandom(seed, 'profile_read', campaignId, ident)
      if (r < 0.03) return null
      if (r < 0.05) throw W.renderError(E, { code: '114', message: 'Tham số không hợp lệ' }, rt, 'read')
      const infra = infraError('zalo_find_phone_user', 'read')
      if (infra) throw infra
      return profileOf(ident, ident)
    },
    saveResolvedProfile: async ctx => { ownDb('lưu hồ sơ', { inputDataId: ctx.target.id }) },
    // ---- Cổng kiểm ----
    isOptedOut: async (ctx, identity) => {
      const k = String(identity.phone || identity.globalId || '')
      if (opts.forceOk) return false
      if (callRandom() < 0.005) throw new Error('Không kiểm được danh sách từ chối: fetch failed')
      return W.unitRandom(seed, 'optout', campaignId, k) < 0.02
    },
    prepareOptOutLink: async (ctx, identity) => {
      if (!opts.forceOk && callRandom() < 0.005) throw new Error('Không tạo được link từ chối nhận tin')
      return { id: crypto.randomUUID(), isOptedOut: W.unitRandom(seed, 'optout', campaignId, identity.globalId) < 0.02 }
    },
    takeContentIndex: async (ctx, actionCode, count) => {
      const r = await rpc('SELECT public.aka_agent_engine_take_content_index_v1($1, $2, $3, $4) AS r', [ctx.targetRunId, ctx.leaseToken, actionCode, count])
      if (!r.ok) throw new Error(r.reason)
      return r.index
    },
    businessNow: async () => new Date(),
    smsBusinessNow: async () => new Date(),
    rewriteMessage: async (ctx, content) => {
      if (!opts.forceOk && callRandom() < 0.05) throw new Error('AI tạm thời không phản hồi')
      return '```text\n' + content + '\n```'
    },
    // ---- Gửi ----
    prepareMedia: async (ctx, items) => {
      if (rt === 'fly' && items.length > 10) throw E.mediaUnavailableError('Mỗi lượt gửi Zalo Server chỉ hỗ trợ tối đa 10 tệp.')
      if (!opts.forceOk && callRandom() < 0.01) throw E.mediaUnavailableError('Không tải được tệp media của chiến dịch')
      return items.map(item => ({ name: E.campaignMediaName(item) || 'media.jpg', ref: item }))
    },
    sendText: async (ctx, uid, message, threadType = 'user') => sendOp(ctx, 'text', messageAction, String(uid), () => {
      const text = typeof message === 'string' ? message : message?.msg
      if (!String(text ?? '').trim()) note('empty_text_sent', { inputDataId: ctx.target.id })
      if (/#\{|\{[^}]*\|[^}]*\}/.test(String(text))) note('unrendered_template_sent', { inputDataId: ctx.target.id, text: String(text).slice(0, 120) })
      return { response: { message: { msgId: msgId() } }, msgId: msgId() }
    }),
    sendMedia: async (ctx, input) => sendOp(ctx, 'media', messageAction, String(input.threadId), () => {
      if (!input.files?.length) note('media_without_files', { inputDataId: ctx.target.id })
      return { response: { media: input.files.length }, msgId: msgId() }
    }),
    sendFriendRequest: async (ctx, uid, message) => sendOp(ctx, 'friend', 'zalo_add_friend', String(uid), () => {
      if (String(message ?? '').length > 150) note('friend_message_too_long', { inputDataId: ctx.target.id, length: String(message).length })
      return { ok: 1 }
    }),
    friendStatus: async (ctx, uid) => {
      const r = W.unitRandom(seed, 'friend', campaignId, String(uid))
      return r < 0.12 ? true : r > 0.97 ? null : false
    },
    applyLabel: async (ctx, uid, labelId, skip) => sendOp(ctx, 'label', 'zalo_tag_contact', String(uid), r => {
      if (r.labelNotFound) return { kind: 'label_not_found', message: 'Tag Zalo không tồn tại' }
      if (skip?.length && W.unitRandom(seed, 'skiplabel', campaignId, uid) < 0.15) return { kind: 'excluded', matchedLabelNames: ['Tag loại trừ'] }
      return { kind: 'applied', labelText: 'Tag mẫu' }
    }),
    mirrorLabel: async ctx => { ownDb('ghi tag danh bạ', { inputDataId: ctx.target.id }) },
    changeAlias: async (ctx, uid, alias) => sendOp(ctx, 'alias', 'zalo_change_alias', String(uid), () => {
      if (String(alias).length > 50) {
        note('alias_too_long', { inputDataId: ctx.target.id, length: String(alias).length })
        throw W.renderError(E, { code: '112', message: 'Lỗi không xác định' }, rt, 'send')
      }
      return { ok: 1 }
    }),
    applyAkaBizTags: async ctx => { ownDb('gắn tag akaBiz', { inputDataId: ctx.target.id }); return 1 },
    addGroupMember: async (ctx, input) => sendOp(ctx, 'add_member', 'zalo_add_group_member', String(input.memberId), () => {
      const r = W.unitRandom(seed, 'addmode', campaignId, input.memberId)
      const outcome = r < 0.7 ? 'added' : r < 0.85 ? 'invited' : r < 0.95 ? 'already_member' : (input.useShareMethod ? 'link_sent' : 'added')
      const messages = { added: 'Đã thêm thành viên vào group', invited: 'Đã gửi lời mời vào group', link_sent: 'Gửi lời mời thành công',
        already_member: 'Đã là thành viên của group' }
      return { groupId: input.groupId, groupName: 'Nhóm đích', groupType: 1, mode: outcome === 'link_sent' ? 'share_group_link' : 'direct_add',
        outcome, message: messages[outcome], groupLink: outcome === 'link_sent' ? 'https://zalo.me/g/abc' : null, response: { ok: 1 } }
    }),
    joinGroupByLink: async (ctx, link) => sendOp(ctx, 'join', 'zalo_join_group_link', String(link), () => {
      const r = W.unitRandom(seed, 'join', campaignId, link)
      const outcome = r < 0.6 ? 'joined' : r < 0.8 ? 'pending_approval' : 'already_joined'
      return { link, group: { groupId: 'g' + W.hash32(link) }, groupId: String(W.hash32(link)), groupName: 'Nhóm link', outcome, response: { ok: 1 },
        zaloCode: null, zaloMessage: null }
    }),
    saveJoinedGroup: async ctx => { ownDb('lưu group', { inputDataId: ctx.target.id }) },
    undoFriendRequest: async (ctx, uid) => sendOp(ctx, 'undo', 'zalo_cancel_sent_friend_request', String(uid), () => ({ ok: 1 })),
    // ---- Loại trừ gửi / danh sách không gửi ----
    sendExclusionSnapshot: async () => {
      if (entry.sample.sampleId % 17 === 0) throw new E.SendExclusionRpcError('config_invalid', 'Nhóm loại trừ đã bị xoá')
      if (callRandom() < 0.01) throw new Error('fetch failed')
      const sel = W.object(entry.extra.zaloSendExclusionsByAccountId)[String(accountId)] || { groupId: null, blocklistIds: [] }
      return { catalog: W.EXCLUSION_CATALOG, group: sel.groupId ? W.exclusionGroup(entry.sample, accountId) : null,
        blocklistUids: sel.blocklistIds?.length ? universe.slice(0, 3).map(u => u.uid).concat(entry.blockUids || []) : [] }
    },
    sendExclusionFacts: async (ctx, payload) => {
      if (callRandom() < 0.01) throw new Error('canceling statement due to statement timeout')
      const r = W.unitRandom(seed, 'facts', campaignId, payload.uid)
      return payload.tags ? { akabiz_contact: { ids: r < 0.2 ? ['7'] : [] }, campaign_delivery: null }
        : { akabiz_contact: null, campaign_delivery: r < 0.3 ? { daysSince: 1 + Math.floor(r * 10) } : null }
    },
    labelMembership: async (ctx, contextRunId, uid) => {
      if (callRandom() < 0.01) throw W.renderError(E, { code: 'ECONNRESET', message: 'socket hang up' }, rt, 'read')
      return { ids: W.unitRandom(seed, 'labels', campaignId, uid) < 0.2 ? ['11'] : [], availableValues: ['11', '12', '13'] }
    },
    friendRequestStatus: async (ctx, uid) => {
      if (callRandom() < 0.01) throw W.renderError(E, { code: '114', message: 'Tham số không hợp lệ' }, rt, 'read')
      const friend = W.unitRandom(seed, 'friend', campaignId, String(uid)) < 0.12
      return { is_friend: friend ? 1 : 0, is_requesting: 0, is_requested: 0 }
    },
    friendBlocklist: async () => ({ groupId: 1, groupName: 'Danh sách không gửi', uids: universe.slice(0, 2).map(u => u.uid).concat(entry.blockUids || []) }),
    // ---- Theo dõi tương tác ----
    engagementBegin: (ctx, targetUid) => {
      note('engagement_begin', { inputDataId: ctx.target.id, targetRunId: ctx.targetRunId })
      return { revision: 'rev-1', sentAt: new Date().toISOString(), accountZaloUid: `acc-${accountId}`, operationId: crypto.randomUUID() }
    },
    engagementAbandon: ctx => note('engagement_abandon', { inputDataId: ctx.target.id, targetRunId: ctx.targetRunId }),
    engagementStage: (ctx, source) => note('engagement_stage', { inputDataId: ctx.target.id, targetRunId: ctx.targetRunId, actionType: source.actionType }),
    engagementRegister: (detailId, source) => note('engagement_register', { detailId, actionType: source.actionType, messageIds: source.messageIds }),
    // ---- Kiêm SMS ----
    pushInternalSms: async (ctx, input) => input.accountIds.map(id => ({ accountId: id, ok: true })),
    pushExternalSms: async () => ({ integrationMissing: true, results: [] }),
    // ---- Cấp chiến dịch: gửi dạng chia sẻ ----
    forwardMessage: async (ctx, input) => {
      if (hooks.beforeSend) await hooks.beforeSend(ctx, 'forward')
      const infra = infraError(messageAction, 'send')
      const callId = nextCallId()
      const running = opts.query ? await opts.query(`SELECT i.id, i.uid, tr.id AS run FROM public.auto_campaign_input_data i
        JOIN public.auto_engine_target_runs tr ON tr.input_data_id = i.id AND tr.completed_at IS NULL
        WHERE i.campaign_id = $1 AND i.status = 'đang chạy'`, [campaignId]) : []
      const rowsOf = threadId => running.filter(r => String(r.uid ?? '').replace(/^g/, '') === String(threadId).replace(/^g/, ''))
      const results = input.threadIds.map(threadId => {
        const p = personaOf(String(threadId).replace(/^g/, ''), messageAction)
        if (W.unitRandom(seed, 'missing', campaignId, threadId) < 0.01) return null
        return p.ok ? { threadId, ok: true, raw: { msgId: msgId() }, engagementMapped: true }
          : { threadId, ok: false, errorCode: p.code || null, errorMessage: p.message || 'Chia sẻ tin nhắn Zalo thất bại' }
      })
      for (const [i, threadId] of input.threadIds.entries()) {
        const res = results[i]
        const owners = rowsOf(threadId)
        log.sends.push({ campaignId, inputDataId: owners.length === 1 ? Number(owners[0].id) : null, owners: owners.map(o => Number(o.id)),
          threadId: String(threadId), targetRunId: owners.length === 1 ? Number(owners[0].run) : ctx.targetRunId, part: 'forward', action: messageAction, callId,
          ok: infra ? false : res ? res.ok : null, possiblyDelivered: infra ? infra.phase === 'in_flight' : res ? res.ok : true, at: Date.now(),
          error: infra ? String(infra.signal?.code ?? infra.message) : res && !res.ok ? res.errorCode : null })
      }
      if (infra) throw infra
      return { response: { forwarded: input.threadIds.length }, results: results.filter(Boolean) }
    },
    // ---- Cấp chiến dịch: lấy data đầu lượt ----
    materializeState: async ctx => E.materializeStateFrom(await mat(ctx, 'state')),
    materializeClear: async ctx => ({ cleared: Number((await mat(ctx, 'clear')).cleared) || 0 }),
    materializeInsert: async (ctx, rows, o) => ({ inserted: Number((await mat(ctx, 'insert', { rows, ...(o.vnDate ? { vnDate: o.vnDate } : {}) })).inserted) || 0 }),
    materializeHold: async (ctx, hold) => { note('materialize_hold', { hold }); await mat(ctx, 'hold', hold) },
    getAllFriendsPage: async (ctx, count, page) => {
      if (callRandom() < 0.03 * chaos) throw W.renderError(E, { code: 'ECONNRESET', message: 'socket hang up' }, rt, 'read')
      return page === 1 ? universe.map(u => ({ userId: u.uid, displayName: u.name, zaloName: u.name, phoneNumber: u.phone, sdob: u.sdob })) : []
    },
    friendTagConversations: async () => {
      if (entry.sample.sampleId % 13 === 0) throw new E.ZaloSourceTagError('Tag Zalo không tồn tại')
      return universe.filter(u => u.tagged).map(u => u.uid)
    },
    getFriendRecommendations: async () => ({ profiles: universe.map(u => ({ uid: u.uid, displayName: u.name, phone: u.phone })),
      totalItems: universe.length, recommendedItems: universe.length, missingUidItems: 0, hasRecommendationList: true }),
    getSentFriendRequests: async () => ({ profiles: universe.map(u => ({ uid: u.uid, name: u.name, sentAt: u.sentAt, requestMessage: 'Kết bạn nhé' })),
      totalItems: universe.length, missingUidItems: 0 }),
    saveFriendContacts: async () => {}
  }
  return port
}

module.exports = { makePort, messageActionOf, identOf }
