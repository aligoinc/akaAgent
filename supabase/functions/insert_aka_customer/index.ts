import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const ORGANIZATION_ID = 1
const CRM_TYPE_NEW = 1
const CRM_TYPE_RETURNING = 2
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface OwnerResolution {
  orgStaffId: number | null
  organizationId: number | null
  source: 'existing_owner' | 'existing_staff_id' | 'request_staff_id' | 'rule' | 'none'
  keyword?: string
}

function validatePhone(phone: string): { valid: boolean; formatted: string | null; error?: string } {
  if (!phone) {
    return { valid: false, formatted: null, error: 'Phone is required' }
  }
  let cleaned = phone.replace(/[\s\-\.]/g, '')
  if (cleaned.startsWith('+84')) {
    cleaned = '0' + cleaned.slice(3)
  } else if (cleaned.startsWith('84') && cleaned.length === 11) {
    cleaned = '0' + cleaned.slice(2)
  }
  if (/^[1-9][0-9]{8}$/.test(cleaned)) {
    cleaned = '0' + cleaned
  }
  const phoneRegex = /^0[1-9][0-9]{8}$/
  if (!phoneRegex.test(cleaned)) {
    return { valid: false, formatted: null, error: 'Invalid phone format' }
  }
  return { valid: true, formatted: cleaned }
}

function formatDateVN(isoString: string | null): string {
  if (!isoString) return ''
  const date = new Date(isoString)
  const vnTime = new Date(date.getTime() + 7 * 60 * 60 * 1000)
  const day = vnTime.getUTCDate().toString().padStart(2, '0')
  const month = (vnTime.getUTCMonth() + 1).toString().padStart(2, '0')
  const year = vnTime.getUTCFullYear()
  const hours = vnTime.getUTCHours().toString().padStart(2, '0')
  const minutes = vnTime.getUTCMinutes().toString().padStart(2, '0')
  return `${day}/${month}/${year} ${hours}:${minutes}`
}

function daysBetween(date1: Date, date2: Date): number {
  const oneDay = 24 * 60 * 60 * 1000
  const d1 = new Date(date1.getFullYear(), date1.getMonth(), date1.getDate())
  const d2 = new Date(date2.getFullYear(), date2.getMonth(), date2.getDate())
  return Math.floor((d2.getTime() - d1.getTime()) / oneDay)
}

function todayStartVnIso(): string {
  const now = new Date()
  const vn = new Date(now.getTime() + 7 * 60 * 60 * 1000)
  return new Date(Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate(), 0, 0, 0) - 7 * 60 * 60 * 1000).toISOString()
}

function normalizeKeyword(body: any, existing?: any): string {
  const raw = body.akabiz_keyword ?? existing?.akabiz_keyword ?? body.form_title ?? existing?.form_title ?? 'data'
  const keyword = String(raw || '').trim()
  return keyword || 'data'
}

function logEvent(level: 'info' | 'warn' | 'error', event: string, payload: Record<string, unknown>): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...payload })
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

async function findOrgStaffByChatStaffId(supabase: any, staffId: unknown): Promise<OwnerResolution | null> {
  const value = typeof staffId === 'string' ? staffId.trim() : ''
  if (!value || !UUID_RE.test(value)) return null

  const { data, error } = await supabase
    .from('org_staff')
    .select('id, organization_id, is_active')
    .eq('chat_staff_id', value)
    .eq('is_active', true)
    .maybeSingle()

  if (error) {
    logEvent('warn', 'insert_aka_customer.staff_lookup_failed', { message: error.message })
    return null
  }
  if (!data) return null

  return {
    orgStaffId: Number(data.id),
    organizationId: Number(data.organization_id),
    source: 'request_staff_id',
  }
}

async function resolveOwnerFromRules(supabase: any, keyword: string): Promise<OwnerResolution | null> {
  const { data: rules, error } = await supabase
    .from('aka_data_split_rules')
    .select('id, org_staff_id, keywords, max_contact_in_day')
    .eq('organization_id', ORGANIZATION_ID)
    .eq('is_active', true)

  if (error) {
    logEvent('warn', 'insert_aka_customer.rule_load_failed', { keyword, message: error.message })
    return null
  }

  const staffIds = [...new Set((rules || []).map((rule: any) => Number(rule.org_staff_id)).filter((id: number) => Number.isFinite(id) && id > 0))]
  const { data: staffRows, error: staffError } = staffIds.length > 0
    ? await supabase
      .from('org_staff')
      .select('id, organization_id, is_active')
      .in('id', staffIds)
      .eq('is_active', true)
    : { data: [], error: null }

  if (staffError) {
    logEvent('warn', 'insert_aka_customer.rule_staff_load_failed', { keyword, message: staffError.message })
    return null
  }

  const staffById = new Map((staffRows || []).map((staff: any) => [Number(staff.id), staff]))
  const candidates = (rules || [])
    .filter((rule: any) => staffById.has(Number(rule.org_staff_id)))
    .filter((rule: any) => {
      const keywords = Array.isArray(rule.keywords) ? rule.keywords.map((item: unknown) => String(item).trim()).filter(Boolean) : []
      return keywords.length === 0 || keywords.includes(keyword)
    })

  if (candidates.length === 0) {
    logEvent('warn', 'insert_aka_customer.no_matching_split_rule', { keyword })
    return null
  }

  const todayStart = todayStartVnIso()
  const enriched = []
  for (const rule of candidates) {
    const ownerId = Number(rule.org_staff_id)
    const { count } = await supabase
      .from('aka_customer')
      .select('id', { count: 'exact', head: true })
      .eq('org_staff_id_owner', ownerId)
      .gte('created_at', todayStart)

    const { data: lastRow } = await supabase
      .from('aka_customer')
      .select('created_at')
      .eq('org_staff_id_owner', ownerId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    enriched.push({
      rule,
      countToday: count || 0,
      lastAssignedAt: lastRow?.created_at ? new Date(lastRow.created_at).getTime() : 0,
      maxContactInDay: rule.max_contact_in_day === null || rule.max_contact_in_day === undefined
        ? null
        : Number(rule.max_contact_in_day),
    })
  }

  enriched.sort((a, b) => a.lastAssignedAt - b.lastAssignedAt)

  const allFull = enriched.every(item => item.maxContactInDay !== null && item.countToday >= item.maxContactInDay)
  const chosen = enriched.find(item => (
    allFull ||
    item.maxContactInDay === null ||
    item.countToday < item.maxContactInDay
  ))

  if (!chosen) return null

  return {
    orgStaffId: Number(chosen.rule.org_staff_id),
    organizationId: Number(staffById.get(Number(chosen.rule.org_staff_id))?.organization_id ?? ORGANIZATION_ID),
    source: 'rule',
    keyword,
  }
}

async function resolveOwner(supabase: any, body: any, existing?: any): Promise<OwnerResolution> {
  if (existing?.org_staff_id_owner) {
    return {
      orgStaffId: Number(existing.org_staff_id_owner),
      organizationId: null,
      source: 'existing_owner',
    }
  }

  const existingStaffOwner = await findOrgStaffByChatStaffId(supabase, existing?.staff_id)
  if (existingStaffOwner) return { ...existingStaffOwner, source: 'existing_staff_id' }

  const requestStaffOwner = await findOrgStaffByChatStaffId(supabase, body.staff_id)
  if (requestStaffOwner) return requestStaffOwner

  const keyword = normalizeKeyword(body, existing)
  const ruleOwner = await resolveOwnerFromRules(supabase, keyword)
  if (ruleOwner) return ruleOwner

  return { orgStaffId: null, organizationId: null, source: 'none', keyword }
}

async function callCreateAkaCrm(args: {
  supabaseUrl: string
  serviceKey: string
  customerData: any
  crmTypeId: number
  owner: OwnerResolution
  note: string | null
}): Promise<any | null> {
  try {
    const response = await fetch(`${args.supabaseUrl}/functions/v1/create-aka-crm`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${args.serviceKey}`,
      },
      body: JSON.stringify({
        customer_id: Number(args.customerData.id),
        crm_type_id: args.crmTypeId,
        org_staff_owner_id: args.owner.orgStaffId,
        organization_id: args.owner.organizationId,
        customer_name: args.customerData.name ?? null,
        customer_phone: args.customerData.phone ?? null,
        note: args.note,
        source: 'insert_aka_customer',
      }),
    })
    const json = await response.json().catch(() => null)
    if (!response.ok || json?.ok !== true) {
      logEvent('error', 'insert_aka_customer.create_crm_failed', {
        customer_id: args.customerData.id,
        status: response.status,
        error: json?.error ?? json?.code ?? 'unknown',
      })
      return null
    }
    return json
  } catch (error) {
    logEvent('error', 'insert_aka_customer.create_crm_exception', {
      customer_id: args.customerData.id,
      message: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

async function syncCustomerOwnerFromCrm(supabase: any, customerData: any, crmResult: any): Promise<any> {
  const ownerId = Number(crmResult?.org_staff_owner_id)
  if (!Number.isFinite(ownerId) || ownerId <= 0) return customerData
  if (Number(customerData.org_staff_id_owner) === ownerId) return customerData

  const { data, error } = await supabase
    .from('aka_customer')
    .update({
      org_staff_id_owner: ownerId,
      org_staff_create_id: customerData.org_staff_create_id ?? ownerId,
      org_staff_update_id: ownerId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', customerData.id)
    .select()
    .single()

  if (error) {
    logEvent('warn', 'insert_aka_customer.sync_random_owner_failed', {
      customer_id: customerData.id,
      owner_id: ownerId,
      message: error.message,
    })
    return customerData
  }
  return data
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const supabase = createClient(supabaseUrl, serviceKey)

    const body = await req.json()

    // 1. Validate phone
    const phoneValidation = validatePhone(body.phone)
    if (!phoneValidation.valid) {
      return new Response(
        JSON.stringify({ success: false, error: phoneValidation.error }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    const phone = phoneValidation.formatted
    const now = new Date()
    const nowISO = now.toISOString()
    const today = nowISO.split('T')[0]

    // 2. Check phone đã tồn tại chưa
    const { data: existing } = await supabase
      .from('aka_customer')
      .select('*')
      .eq('phone', phone)
      .maybeSingle()

    let result
    let customerData
    let returnNote = null
    let daysAway = 0
    const owner = await resolveOwner(supabase, body, existing)

    if (existing) {
      // ========== KHÁCH CŨ QUAY LẠI ==========
      const isToday = existing.last_update_date === today

      const lastDate = existing.return_date
        ? new Date(existing.return_date)
        : new Date(existing.created_at)
      daysAway = daysBetween(lastDate, now)

      if (daysAway === 0) {
        returnNote = 'Khách hàng quay trở lại trong ngày'
      } else {
        returnNote = `Khách hàng quay trở lại sau ${daysAway} ngày`
      }

      const ownerUpdate = !existing.org_staff_id_owner && owner.orgStaffId
        ? {
          org_staff_id_owner: owner.orgStaffId,
          org_staff_create_id: existing.org_staff_create_id ?? owner.orgStaffId,
          org_staff_update_id: owner.orgStaffId,
        }
        : {}

      const { data, error } = await supabase
        .from('aka_customer')
        .update({
          city: body.city || existing.city,
          inbox_url: body.refe || body.inbox_url || existing.inbox_url,
          ip_address: body.ip_address || existing.ip_address,
          name: body.name || existing.name,
          email: body.email || existing.email,
          device_type: body.device_type || existing.device_type,
          browser: body.browser || existing.browser,
          form_title: body.form_title || existing.form_title,
          ref_url: body.refe1 || body.ref_url || existing.ref_url,
          os: body.os || existing.os,
          product: body.product || existing.product,
          akabiz_keyword: body.akabiz_keyword || existing.akabiz_keyword,
          channel: body.channel || existing.channel,
          countupdate: (existing.countupdate || 0) + 1,
          countupdate_today: isToday ? (existing.countupdate_today || 0) + 1 : 1,
          last_update_date: today,
          return_date: nowISO,
          updated_at: nowISO,
          split_note: returnNote,
          ...ownerUpdate,
        })
        .eq('id', existing.id)
        .select()
        .single()

      if (error) throw error

      customerData = data

      result = {
        action: 'updated',
        is_return_customer: true,
        return_count: (existing.countupdate || 0) + 1,
        days_away: daysAway,
      }

    } else {
      // ========== KHÁCH MỚI ==========
      const ownerInsert = owner.orgStaffId
        ? {
          org_staff_id_owner: owner.orgStaffId,
          org_staff_create_id: owner.orgStaffId,
          org_staff_update_id: owner.orgStaffId,
        }
        : {}

      const { data, error } = await supabase
        .from('aka_customer')
        .insert({
          city: body.city || null,
          inbox_url: body.refe || body.inbox_url || null,
          ip_address: body.ip_address || null,
          name: body.name || null,
          email: body.email || null,
          phone: phone,
          device_type: body.device_type || null,
          browser: body.browser || null,
          form_title: body.form_title || null,
          ref_url: body.refe1 || body.ref_url || null,
          os: body.os || null,
          product: body.product || null,
          akabiz_keyword: body.akabiz_keyword || null,
          channel: body.channel || null,
          status: 'new',
          countupdate: 0,
          countupdate_today: 0,
          last_update_date: today,
          return_date: null,
          split_note: null,
          ...ownerInsert,
        })
        .select()
        .single()

      if (error) throw error

      customerData = data

      result = {
        action: 'inserted',
        is_return_customer: false,
        return_count: 0,
        days_away: 0,
      }
    }

    logEvent('info', 'insert_aka_customer.owner_resolved', {
      customer_id: customerData.id,
      owner_source: owner.source,
      owner_id: owner.orgStaffId,
      keyword: owner.keyword ?? null,
    })

    const shouldCreateCrm = !existing || daysAway > 0
    if (shouldCreateCrm) {
      const crmTypeId = existing ? CRM_TYPE_RETURNING : CRM_TYPE_NEW
      const crmResult = await callCreateAkaCrm({
        supabaseUrl,
        serviceKey,
        customerData,
        crmTypeId,
        owner,
        note: existing ? returnNote : 'Khách hàng mới',
      })
      if (crmResult?.assigned_randomly) {
        logEvent('info', 'insert_aka_customer.owner_random_assigned', {
          customer_id: customerData.id,
          owner_id: crmResult.org_staff_owner_id,
          keyword: owner.keyword ?? null,
        })
      }
      customerData = await syncCustomerOwnerFromCrm(supabase, customerData, crmResult)
    }

    // 3. Return response
    return new Response(
      JSON.stringify({
        success: true,
        ...result,
        data: {
          ...customerData,
          created_at: formatDateVN(customerData.created_at),
          updated_at: formatDateVN(customerData.updated_at),
          return_date: formatDateVN(customerData.return_date),
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})
