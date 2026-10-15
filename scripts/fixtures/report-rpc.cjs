// Adapt the typed RPC contract to the existing independent row/filter fixture.
// Live SQL/HTTP smoke tests separately validate the deployed implementation.
const quote = value => '"' + String(value).replace(/[\\"]/g, c => '\\' + c) + '"'
function reportRpcRequest(client, name, args) {
  if (name !== 'aka_agent_read_report_page') throw new Error(`Unexpected RPC ${name}`)
  const q = args.p_query, pending = q.source === 'pending', summary = q.view === 'summary'
  let request = client.from(pending ? 'auto_campaign_input_data' : 'auto_campaign_details')
  const select = pending
    ? (summary || q.head ? 'id,campaign_id,schedule' : 'id,campaign_id,name,phone,uid,email,note,schedule,created_at')
      + ',auto_campaigns!inner(staff_id,organization_id,is_delete,account_id),pending_result:auto_campaign_details()'
    : (summary ? 'id,input_data_id,account_id,action_code,status,status_id,report_group,created_at' : 'id,input_data_id,campaign_id,account_id,action_code,action_name,status,error_code,log,data,post_url,created_at,main_status(name),sub_status(name),report_input(name,uid,phone,email,auto_campaigns!inner(staff_id,organization_id))')
      + (q.requireCampaign ? ',auto_campaigns!inner(id,name,staff_id,organization_id)' : ',auto_campaigns(id,name,staff_id,organization_id)')
  request=request.select(select, { ...(q.count || q.head ? {count:'exact'} : {}), ...(q.head ? {head:true} : {}) }).eq('is_delete',false)
  if (q.campaignIds) request=request.in('campaign_id',q.campaignIds)
  if (pending || q.requireCampaign || !summary) request=request.eq('auto_campaigns.staff_id',args.p_staff_id).eq('auto_campaigns.organization_id',args.p_organization_id)
  const or=[]
  if (pending) {
    request=request.eq('status','chờ xử lý').eq('auto_campaigns.is_delete',false).in('auto_campaigns.account_id',q.accountIds)
    if (summary) request=q.ownSchedule ? request.gte('schedule',q.startIso).lt('schedule',q.endIso) : request.is('schedule',null)
    else {
      or.push(`or(and(schedule.gte.${quote(q.startIso)},schedule.lt.${quote(q.endIso)}),and(schedule.is.null,auto_campaigns.schedule.gte.${quote(q.startIso)},auto_campaigns.schedule.lt.${quote(q.endIso)}))`)
      request=request.eq('pending_result.report_group','pending').eq('pending_result.action_code',q.actionCodes[0])
        .eq('pending_result.account_id',q.accountIds[0]).eq('pending_result.is_delete',false)
        .gte('pending_result.created_at',q.startIso).lt('pending_result.created_at',q.endIso).is('pending_result',null)
    }
    if (q.afterId !== undefined) or.push(`or(campaign_id.gt.${q.afterCampaignId},and(campaign_id.eq.${q.afterCampaignId},id.gt.${q.afterId}))`)
    request=request.order('campaign_id').order('id')
  } else {
    request=request.in('account_id',q.accountIds).in('action_code',q.actionCodes).gte('created_at',q.startIso).lt('created_at',q.endIso)
    const f=q.filter
    if (f?.kind==='group') or.push(`or(${f.group==='all' ? 'report_group.in.(success,failure,skipped,pending)' : `report_group.eq.${f.group}`}${f.legacyStatuses?.length ? `,and(report_group.is.null,status.in.(${f.legacyStatuses.map(quote).join(',')}))` : ''})`)
    if (f?.kind==='status' || f?.kind==='legacy') {
      or.push('or(report_group.is.null,report_group.neq.pending)')
      if (f.kind==='legacy') or.push(`and(status_id.is.null,status.eq.${quote(f.status)})`)
      else or.push(`or(status_id.eq.${f.statusId}${f.legacyStatus !== undefined ? `,and(status_id.is.null,status.eq.${quote(f.legacyStatus)}))` : ')'}`)
    }
    if (q.afterCreatedAt) { const op=summary?'gt':'lt'; or.push(`or(created_at.${op}.${quote(q.afterCreatedAt)},and(created_at.eq.${quote(q.afterCreatedAt)},id.${op}.${q.afterId}))`) }
    request=request.order('created_at',{ascending:summary}).order('id',{ascending:summary})
    if (!summary) request=request.eq('report_input.auto_campaigns.staff_id',args.p_staff_id).eq('report_input.auto_campaigns.organization_id',args.p_organization_id)
  }
  if (or.length) request=request.or(`and(${or.join(',')})`)
  if (!q.head) request=q.offset !== undefined ? request.range(q.offset,q.offset+q.limit-1) : request.limit(q.limit ?? 1000)
  const wrapped={
    abortSignal(signal) { request=request.abortSignal(signal); return wrapped },
    then(resolve,reject) { return Promise.resolve(request).then(result=>resolve({error:result.error,data:{rows:result.data||[],count:q.count||q.head ? result.count : null}}),reject) }
  }
  return wrapped
}
module.exports={reportRpcRequest}
