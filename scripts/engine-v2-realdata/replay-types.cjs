// Đăng ký loại chiến dịch cho replay.cjs: dựng cấu hình lõi từ dòng auto_campaigns, kiểm hỗ trợ, và cổng Zalo giả
// trả đúng kết quả Zalo đã trả trong lịch sử của data (auto_campaign_details.data).
'use strict'

const NUMERIC = /^-?\d+$/
const object = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {})

/** Lỗi Zalo của lịch sử → lỗi cổng như adapter thật: mã số là Zalo đã trả lời; errno/câu lỗi là lỗi đường truyền. */
function historyError(E, data, operation) {
  const z = object(data?.zalo)
  const message = String(z.message || data?.error || 'Lỗi Zalo')
  const rawCode = z.code ?? data?.rawCode // Desktop/VPS: data.zalo.code; bộ chạy cũ của Fly: data.rawCode
  const code = rawCode === undefined || rawCode === null ? '' : String(rawCode)
  const error = Object.assign(new Error(message), code ? { code: NUMERIC.test(code) ? Number(code) : code } : {})
  return E.zaloPortErrorFrom(error, { operation, answered: NUMERIC.test(code) })
}

function rowsOf(ctx, target) {
  return ctx.historyByTarget.get(String(target.id)) || ctx.historyByTarget.get(Number(target.id)) || []
}

function msgIdOf(response) {
  const r = object(response)
  return r.contentResponse?.message?.msgId ?? r.message?.msgId ?? r.msgId ?? null
}

const zaloMessagePhone = {
  campaignConfig: c => ({
    id: Number(c.id), actionId: c.action_id, accountId: Number(c.account_id), content: c.content ?? '',
    extraSettings: object(c.extra_settings), images: Array.isArray(c.images) ? c.images : [], dataTargetSourceMode: c.data_target_source_mode ?? null
  }),
  // Như Desktop/Fly: bộ kiểm chung của bảng loại (chặn Nhóm data, nhóm theo thời gian thực, gửi dạng chia sẻ) rồi tới loại.
  support: (E, cfg) => E.zaloCampaignV2Support(cfg, { engagementTrackingEnabled: false }),
  unitConfig: (E, cfg) => ({
    targetLabel: E.zaloMessagePhoneTargetLabel,
    actionName: code => E.ZALO_MESSAGE_PHONE_ACTION_NAMES[code] ?? code,
    ...E.zaloMessagePhoneClaimPlan(cfg)
  }),
  buildSteps: (E, cfg, port) => E.buildZaloMessagePhoneSteps(cfg, port),
  replayPort: (E, ctx, target, _cfg, messageCode = 'zalo_message_stranger') => {
    const rows = rowsOf(ctx, target)
    const first = code => rows.find(r => r.action_code === code)
    const lookup = first('zalo_find_phone_user'), message = first(messageCode), friend = first('zalo_add_friend')
    const partial = Boolean(message && message.status !== 'thành công'
      && (message.data?.partialSend || /^Đã gửi file nhưng gửi nội dung thất bại/.test(message.log || '')))
    let sendCalls = 0
    const send = async kind => {
      sendCalls++
      const failsHere = message && message.status !== 'thành công' && (partial ? sendCalls === 2 : sendCalls === 1)
      if (failsHere) throw historyError(E, message.data, 'send')
      const response = message?.data?.response ?? {}
      return { response, msgId: msgIdOf(response) ?? (kind === 'media' ? 'replay-media' : null) }
    }
    return {
      findUser: async (_c, phone) => {
        if (lookup && lookup.status !== 'thành công') {
          if ((lookup.data?.zalo?.code ?? lookup.data?.rawCode) !== undefined) throw historyError(E, lookup.data, 'read')
          return null
        }
        const saved = object(lookup?.data?.target)
        return E.normalizeZaloFoundUser({ ...object(saved.raw), uid: saved.uid || saved.raw?.uid || target.uid || `replay-${target.id}`,
          display_name: saved.displayName, zalo_name: saved.originalName, globalId: saved.globalId, gender: saved.gender, phoneNumber: phone })
      },
      phoneSearchLimitScope: async code => ({ 221: 'hour', 312: 'hour', 313: 'day', 304: 'day' })[code] ?? null,
      saveFoundUser: async () => {},
      isOptedOut: async () => false,
      // Link từ chối nhận tin: phát lại không có danh sách từ chối, mỗi data một link giả hợp lệ.
      prepareOptOutLink: async () => ({ id: '0b5d2f8e-1c2a-4d3b-8e4f-5a6b7c8d9e0f', isOptedOut: false }),
      takeContentIndex: async (c, actionCode, count) => {
        const r = await ctx.rpc('SELECT public.aka_agent_engine_take_content_index_v1($1, $2, $3, $4) AS r', [c.targetRunId, c.leaseToken, actionCode, count])
        if (!r.ok) throw new Error(r.reason)
        return r.index
      },
      businessNow: async () => new Date(),
      // Chữ và tệp theo lịch sử: dòng nhắn tin lỗi thì lần gửi ĐẦU lỗi; giao một phần ("Đã gửi file nhưng gửi nội dung thất bại")
      // thì lần gửi tệp được, lần gửi chữ lỗi; thành công thì mọi lần gửi được.
      sendText: async () => send('text'),
      prepareMedia: async (_c, items) => items.map(item => ({ name: E.campaignMediaName(item), ref: E.campaignMediaName(item) })),
      // AI không phát lại được: trả nguyên văn (lịch sử chỉ có câu đã gửi, không có câu trước khi viết lại).
      rewriteMessage: async (_c, content) => content,
      sendMedia: async () => send('media'),
      sendFriendRequest: async () => {
        if (friend && (friend.status !== 'thành công' || (friend.data?.zalo?.code ?? friend.data?.rawCode) !== undefined)) throw historyError(E, friend.data, 'send')
        return friend?.data?.response ?? ''
      },
      // Thao tác phụ theo lịch sử. Không có dòng tag trong lịch sử = bộ cũ đã bỏ qua (bạn bè / tag loại trừ / chưa cấu hình):
      // trả "loại trừ" để hai bên cùng không có dòng. Đổi tên: giả lập luật thật của Zalo (quá 50 ký tự → 112).
      friendStatus: async () => null,
      applyLabel: async () => {
        const tagRow = first('zalo_tag_contact')
        if (!tagRow) return { kind: 'excluded', matchedLabelNames: ['(lịch sử không có dòng tag)'] }
        if (tagRow.status === 'tag không tồn tại') return { kind: 'label_not_found', message: 'Tag Zalo không tồn tại' }
        if (tagRow.status !== 'thành công') throw historyError(E, tagRow.data, 'send')
        return { kind: 'applied', labelText: tagRow.data?.labelName || null }
      },
      mirrorLabel: async () => {},
      changeAlias: async (_c, _uid, alias) => {
        const aliasRow = first('zalo_change_alias')
        const code = String(aliasRow?.data?.zalo?.code ?? aliasRow?.data?.rawCode ?? '')
        if (aliasRow && aliasRow.status !== 'thành công' && code !== '112') throw historyError(E, aliasRow.data, 'send')
        if (alias.length > 50) throw historyError(E, { zalo: { code: '112', message: 'Lỗi không xác định' } }, 'send')
        return aliasRow?.data?.response ?? ''
      },
      applyAkaBizTags: async () => 1
    }
  }
}

/**
 * Nhắn tin người lạ theo UID (thành viên nhóm, khách cũ): như "Nhắn tin theo SĐT" nhưng không tra số; hồ sơ đọc theo UID lấy từ
 * mục tiêu bộ cũ đã ghi trong lịch sử (data.target.raw.profile). Lịch sử không có hồ sơ (đọc lỗi / Zalo không trả) thì không có.
 */
const zaloUidStranger = {
  campaignConfig: zaloMessagePhone.campaignConfig,
  support: zaloMessagePhone.support,
  unitConfig: (E, cfg) => {
    const type = E.zaloCampaignType(cfg.actionId)
    return { targetLabel: type.targetLabel, actionName: code => type.actionNames[code] ?? code, ...type.claimPlan(cfg) }
  },
  buildSteps: (E, cfg, port) => E.zaloCampaignType(cfg.actionId).buildSteps(cfg, port),
  replayPort: (E, ctx, target, cfg) => {
    // Sinh nhật dùng các bước nhắn bạn bè; đề xuất và group thời gian thực dùng các bước thành viên nhóm (nhắn người lạ).
    const messageCode = { zalo_message_friend: 'zalo_message_friend', zalo_message_group: 'zalo_message_group',
      zalo_message_birthday: 'zalo_message_friend' }[cfg?.actionId] ?? 'zalo_message_stranger'
    const base = zaloMessagePhone.replayPort(E, ctx, target, cfg, messageCode)
    const saved = object(rowsOf(ctx, target).find(r => r.data?.target)?.data?.target)
    const raw = object(saved.raw)
    const profile = object(raw.profile)
    return {
      ...base,
      findUser: async () => { throw new Error('Loại theo UID không tra số') },
      getUserProfile: async (_c, uid) => Object.keys(profile).length === 0 ? null
        : E.normalizeZaloFoundUser({ ...profile, userId: raw.profileUid || profile.userId || uid }),
      saveResolvedProfile: async () => {}
    }
  }
}

/** Thêm thành viên vào group: kết quả thêm lấy từ dòng lịch sử (data.mode / data.outcome của bộ chạy Desktop/VPS). */
const zaloAddGroupMember = {
  ...zaloUidStranger,
  replayPort: (E, ctx, target, cfg) => {
    // Data chỉ có SĐT tra số theo dòng "Tìm SĐT" của lịch sử (cổng của loại theo SĐT); data có UID đọc hồ sơ như loại theo UID.
    const base = { ...zaloUidStranger.replayPort(E, ctx, target, cfg), findUser: zaloMessagePhone.replayPort(E, ctx, target, cfg).findUser }
    const add = rowsOf(ctx, target).find(r => r.action_code === 'zalo_add_group_member')
    const messages = { added: 'Đã thêm thành viên vào group', invited: 'Đã gửi lời mời vào group', link_sent: 'Gửi lời mời thành công',
      already_member: 'Đã là thành viên của group' }
    return {
      ...base,
      addGroupMember: async (_c, input) => {
        if (add && add.status !== 'thành công' && add.status !== 'đã là thành viên') throw historyError(E, add.data, 'send')
        const d = object(add?.data)
        const outcome = d.outcome ?? 'added'
        return { groupId: object(d.targetGroup).id ?? input.groupId, groupName: object(d.targetGroup).name ?? null, groupType: object(d.targetGroup).type ?? null,
          mode: d.mode ?? 'direct_add', outcome, message: messages[outcome] ?? messages.added, groupLink: d.groupLink ?? null, response: d.response ?? null }
      }
    }
  }
}

/** Vào group bằng link: kết quả tham gia lấy từ dòng lịch sử (đã tham gia / chờ duyệt / tham gia / lỗi). */
const zaloJoinGroupLink = {
  ...zaloUidStranger,
  replayPort: (E, ctx, target, cfg) => {
    const base = zaloUidStranger.replayPort(E, ctx, target, cfg)
    const row = rowsOf(ctx, target).find(r => r.action_code === 'zalo_join_group_link')
    return {
      ...base,
      joinGroupByLink: async (_c, link) => {
        if (row && row.status !== 'thành công' && row.status !== 'đã tham gia') throw historyError(E, row.data, 'send')
        const d = object(row?.data)
        const outcome = row?.status === 'đã tham gia' ? 'already_joined' : /đang chờ duyệt/.test(row?.log || '') ? 'pending_approval' : 'joined'
        return { link: d.link || link, group: object(d.group), groupId: d.groupId || '', groupName: d.groupName || null, outcome,
          response: d.response ?? null, zaloCode: object(d.zalo).code ?? null, zaloMessage: object(d.zalo).message ?? null }
      },
      saveJoinedGroup: async () => {}
    }
  }
}

/** Huỷ lời mời kết bạn: kết quả huỷ lấy từ dòng lịch sử của data (data lấy từ danh sách lời mời giả dựng bằng data bộ cũ, replay.cjs). */
const zaloCancelSentFriendRequest = {
  ...zaloUidStranger,
  replayPort: (E, ctx, target, cfg) => {
    const base = zaloUidStranger.replayPort(E, ctx, target, cfg)
    const row = rowsOf(ctx, target).find(r => r.action_code === 'zalo_cancel_sent_friend_request')
    return {
      ...base,
      undoFriendRequest: async () => {
        if (row && row.status !== 'thành công') throw historyError(E, row.data, 'send')
        return row?.data?.response ?? { ok: 1 }
      }
    }
  }
}

module.exports = {
  historyError,
  rowsOf,
  zalo_message_birthday: zaloUidStranger,
  zalo_message_friend_recommendation: zaloUidStranger,
  zalo_message_group_realtime: zaloUidStranger,
  zalo_cancel_sent_friend_request: zaloCancelSentFriendRequest,
  zalo_message_phone: zaloMessagePhone,
  zalo_message_group_member: zaloUidStranger,
  zalo_message_remarketing_customer: zaloUidStranger,
  zalo_message_friend: zaloUidStranger,
  zalo_message_group: zaloUidStranger,
  zalo_add_group_member: zaloAddGroupMember,
  zalo_join_group_link: zaloJoinGroupLink
}
