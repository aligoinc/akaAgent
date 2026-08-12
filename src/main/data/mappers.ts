import { AkaBizContactTag, AutoAccount, AutoAccountGroup, AutoProxy, Campaign, CampaignAction, CampaignInput, CampaignInputData, CampaignDetail, CampaignInputStatus, CampaignDetailStatus, AutoAccountContact, AutoAccountContactDataset, AutoAccountContactGroup, ContactType, AutoAccountAction, AutoAccountActionStatus, AutoErrorPolicy, ContentTemplate, ContentTemplateChannelConfig, ContentTemplateChannelName, ContentTemplateChannels, ContentTemplateContentType, ContentTemplateGroup, MediaFile, MediaGroup, ZaloAccount } from '../../shared/types'
import { getCurrentUser } from './currentUser'

export function mapAccountFromDB(row: Record<string, unknown>): AutoAccount {
  const flatformType = row.flatform_type as string
  const isSmsAccount = flatformType === 'sms'
  const organizationId = Number(row.organization_id)
  const currentUser = getCurrentUser()
  const isZaloServerChatAccount = flatformType === 'zalo'
    && currentUser?.organizationId === organizationId
    && currentUser.isChatSync === true
    && row.is_zalo_show_web !== true
    && row.is_zalo_server === true
  const loginStatus = row.login_status as string

  return {
    id: row.id as number,
    name: row.name as string,
    flatformType,
    isZaloShowWeb: flatformType === 'zalo' && row.is_zalo_show_web === true,
    isZaloServer: flatformType === 'zalo' && row.is_zalo_show_web !== true && row.is_zalo_server === true,
    username: isSmsAccount ? ((row.username as string | null | undefined) ?? null) : null,
    password: isSmsAccount ? ((row.password as string | null | undefined) ?? null) : null,
    mobileDeviceId: (row.mobile_device_id as string | null | undefined) ?? null,
    mobileDeviceInfo: (row.mobile_device_info as Record<string, unknown> | null | undefined) ?? null,
    mobileDeviceRegisteredAt: (row.mobile_device_registered_at as string | null | undefined) ?? null,
    mobileDeviceLastSeenAt: (row.mobile_device_last_seen_at as string | null | undefined) ?? null,
    loginStatus,
    status: row.status as string,
    isActive: row.is_active as boolean,
    rateLimitMinutes: (row.rate_limit_minutes as number | null) ?? null,
    accountGroupId: (row.account_group_id as number | null) ?? null,
    accountGroupName: ((row as any).auto_account_groups?.name as string | null | undefined) ?? null,
    accountGroupSettings: ((row as any).auto_account_groups?.settings as AutoAccount['accountGroupSettings']) ?? null,
    proxyId: (row.proxy_id as number | null) ?? null,
    proxyName: ((row as any).auto_proxies?.name as string | null | undefined) ?? null,
    proxyProtocol: ((row as any).auto_proxies?.protocol as AutoAccount['proxyProtocol']) ?? null,
    proxyHost: ((row as any).auto_proxies?.host as string | null | undefined) ?? null,
    proxyPort: ((row as any).auto_proxies?.port as number | null | undefined) ?? null,
    zaloAccountId: (row.zalo_account_id as number | null | undefined) ?? null,
    zaloUid: ((row as any).zalo_accounts?.zalo_uid as string | null | undefined) ?? null,
    zaloDisplayName: ((row as any).zalo_accounts?.display_name as string | null | undefined) ?? null,
    zaloPhone: ((row as any).zalo_accounts?.phone as string | null | undefined) ?? null,
    zaloAvatarUrl: ((row as any).zalo_accounts?.avatar_url as string | null | undefined) ?? null,
    hasZaloSession: isZaloServerChatAccount
      ? loginStatus === 'đã đăng nhập'
      : !!row.zalo_session_updated_at,
    zaloSessionUpdatedAt: (row.zalo_session_updated_at as string | null | undefined) ?? null,
    zaloSessionLastVerifiedAt: (row.zalo_session_last_verified_at as string | null | undefined) ?? null,
    zaloSessionLastError: (row.zalo_session_last_error as string | null | undefined) ?? null,
    hasEmailSession: !!row.email_session_updated_at,
    emailSessionUpdatedAt: (row.email_session_updated_at as string | null | undefined) ?? null,
    emailSessionLastVerifiedAt: (row.email_session_last_verified_at as string | null | undefined) ?? null,
    emailSessionLastError: (row.email_session_last_error as string | null | undefined) ?? null,
    isDelete: row.is_delete as boolean,
    staffId: row.staff_id as number | undefined,
    organizationId: row.organization_id as number | undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  }
}

export function mapZaloAccountFromDB(row: Record<string, unknown>): ZaloAccount {
  return {
    id: row.id as number,
    zaloUid: row.zalo_uid as string,
    displayName: (row.display_name as string | null | undefined) ?? null,
    phone: (row.phone as string | null | undefined) ?? null,
    avatarUrl: (row.avatar_url as string | null | undefined) ?? null,
    metadata: (row.metadata as Record<string, unknown> | null | undefined) ?? {},
    lastSeenAt: (row.last_seen_at as string | null | undefined) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  }
}

export function mapProxyFromDB(row: Record<string, unknown>): AutoProxy {
  return {
    id: row.id as number,
    name: row.name as string,
    protocol: row.protocol as AutoProxy['protocol'],
    host: row.host as string,
    port: row.port as number,
    username: (row.username as string | null) ?? null,
    password: (row.password as string | null) ?? null,
    isActive: row.is_active as boolean,
    isDelete: row.is_delete as boolean,
    usageCount: (row.usage_count as number | null | undefined) ?? 0,
    staffId: row.staff_id as number | undefined,
    organizationId: row.organization_id as number | undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  }
}

export function mapAccountGroupFromDB(row: Record<string, unknown>): AutoAccountGroup {
  return {
    id: row.id as number,
    name: row.name as string,
    flatformType: row.flatform_type as string,
    settings: (row.settings as AutoAccountGroup['settings']) || {},
    isActive: row.is_active as boolean,
    isDelete: row.is_delete as boolean,
    staffId: row.staff_id as number | undefined,
    organizationId: row.organization_id as number | undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  }
}

export function mapCampaignActionFromDB(row: Record<string, unknown>): CampaignAction {
  return {
    id: row.id as string,
    name: row.name as string,
    flatformType: row.flatform_type as string,
    isActive: row.is_active as boolean,
    workflowId: row.workflow_id as number | undefined,
    testWorkflowId: row.test_workflow_id as number | undefined,
    allowMultipleAccounts: typeof row.allow_multiple_accounts === 'boolean' ? row.allow_multiple_accounts : false,
    allowSecondaryAccount: typeof row.allow_secondary_account === 'boolean' ? row.allow_secondary_account : false,
    limitCheckActionCodes: Array.isArray(row.limit_check_action_codes) ? row.limit_check_action_codes as string[] : [],
    isDelete: row.is_delete as boolean,
    createdAt: row.created_at as string
  }
}

export function mapAutoAccountActionFromDB(row: Record<string, unknown>): AutoAccountAction {
  return {
    id: row.id as number,
    name: row.name as string,
    code: row.code as string,
    flatformType: row.flatform_type as string,
    isActive: row.is_active as boolean,
    isDelete: row.is_delete as boolean,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  }
}

export function mapAutoAccountActionStatusFromDB(row: Record<string, unknown>): AutoAccountActionStatus {
  return {
    id: row.id as number,
    accountId: row.account_id as number,
    actionCode: row.action_code as string,
    countActionInDay: row.count_action_in_day as number,
    countDate: row.count_date as string,
    isDisable: row.is_disable as boolean,
    dateEnable: (row.date_enable as string | null) ?? null,
    disabledErrorCode: (row.disabled_error_code as string | null) ?? null,
    disabledReason: (row.disabled_reason as string | null) ?? null,
    disabledAt: (row.disabled_at as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  }
}

export function mapAutoErrorPolicyFromDB(row: Record<string, unknown>): AutoErrorPolicy {
  const disableActionMode = String(row.disable_action_mode || '').trim()
  return {
    id: row.id as number,
    errorType: row.error_type as string,
    errorName: row.error_name as string,
    errorDesc: (row.error_desc as string | null) ?? null,
    errorCode: row.error_code as string,
    errorElement: (row.error_element as string | null) ?? null,
    notiRunningProcess: (row.noti_running_process as string | null) ?? null,
    notiCampaign: (row.noti_campaign as string | null) ?? null,
    updateStatusAccount: (row.update_status_account as string | null) ?? null,
    updateStatusCampaign: (row.update_status_campaign as string | null) ?? null,
    disableActionCodes: Array.isArray(row.disable_action_codes) ? row.disable_action_codes as string[] : [],
    timeDisableActions: (row.time_disable_actions as number | null) ?? null,
    disableActionMode: disableActionMode === 'end_of_day' || disableActionMode === 'indefinite'
      ? disableActionMode
      : 'fixed_minutes',
    countConsecutiveErrors: (row.count_consecutive_errors as number | null) ?? null,
    zaloErrorCodes: Array.isArray(row.zalo_error_codes) ? row.zalo_error_codes as string[] : [],
    detailStatus: (row.detail_status as string | null) ?? null,
    countsTowardLimit: (row.counts_toward_limit as boolean | null | undefined) ?? true,
    countsTowardBadTarget: (row.counts_toward_bad_target as boolean | null | undefined) ?? true,
    updateLoginStatus: (row.update_login_status as string | null) ?? null,
    isActive: row.is_active as boolean,
    isDelete: row.is_delete as boolean,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  }
}

export function mapCampaignFromDB(row: Record<string, unknown>): Campaign {
  const primaryAccount = (row as any).primary_account || (row as any).auto_accounts
  const campaign: Campaign = {
    id: row.id as number,
    name: row.name as string,
    actionId: row.action_id as string,
    accountId: row.account_id as number,
    secondaryAccountId: (row.secondary_account_id as number | null | undefined) ?? null,
    status: row.status as string,
    schedule: row.schedule as string | undefined,
    originalSchedule: (row.original_schedule as string | null) ?? null,
    scheduleType: (row.schedule_type as Campaign['scheduleType']) || 'daily',
    scheduleEndDate: row.schedule_end_date as string | undefined,
    dailyStopTime: (row.daily_stop_time as string | null) ?? null,
    scheduleDays: row.schedule_days as string | undefined,
    scheduleWeekDays: row.schedule_week_days as string | undefined,
    continueNextDay: (row.continue_next_day as boolean) ?? false,
    refreshData: (row.refresh_data as boolean) ?? false,
    content: (row.content as string) || '',
    extraSettings: (row.extra_settings as Campaign['extraSettings']) || {},
    images: (row.images as Campaign['images']) || [],
    log: (row.log as string) || '',
    note: (row.note as string | null) ?? null,
    isDelete: row.is_delete as boolean,
    staffId: row.staff_id as number | undefined,
    organizationId: row.organization_id as number | undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    completedAt: (row.completed_at as string | null) ?? null,
    lastRunAt: (row.last_run_at as string | null) ?? null,
    dataTargetSourceMode: (row.data_target_source_mode as Campaign['dataTargetSourceMode']) || 'direct',
    dataGroupId: (row.data_group_id as number | null | undefined) ?? null,
    provisioningState: (row.provisioning_state as Campaign['provisioningState']) || 'ready',
    creationBundleId: (row.creation_bundle_id as number | null | undefined) ?? null,
    creationBundleChildIndex: (row.creation_bundle_child_index as number | null | undefined) ?? null,
    actionName: (row as any).auto_campaign_actions?.name as string | undefined,
    accountName: primaryAccount?.name as string | undefined
  }

  return campaign
}

export function mapCampaignInputFromDB(row: Record<string, unknown>): CampaignInput {
  return {
    id: row.id as number,
    campaignId: row.campaign_id as number,
    name: row.name as string | undefined,
    phone: row.phone as string | undefined,
    uid: row.uid as string | undefined,
    email: row.email as string | undefined,
    status: row.status as CampaignInputStatus,
    note: row.note as string | undefined,
    schedule: row.schedule as string | undefined,
    dateAction: row.date_action as string | undefined,
    isDelete: row.is_delete as boolean,
    createdAt: row.created_at as string
  }
}

export function mapCampaignInputDataFromDB(row: Record<string, unknown>): CampaignInputData {
  return {
    id: row.id as number,
    campaignId: row.campaign_id as number,
    inputId: (row.input_id as number | null) ?? null,
    name: row.name as string | undefined,
    phone: row.phone as string | undefined,
    phoneCarrier: (row.phone_carrier as CampaignInputData['phoneCarrier'] | null | undefined) ?? null,
    uid: row.uid as string | undefined,
    email: row.email as string | undefined,
    info1: row.info1 as string | undefined,
    info2: row.info2 as string | undefined,
    info3: row.info3 as string | undefined,
    info4: row.info4 as string | undefined,
    info5: row.info5 as string | undefined,
    content: row.content as string | undefined,
    status: row.status as CampaignInputStatus,
    note: row.note as string | undefined,
    schedule: row.schedule as string | undefined,
    dateAction: row.date_action as string | undefined,
    isDelete: row.is_delete as boolean,
    createdAt: row.created_at as string,
    canonicalTargetKey: (row.canonical_target_key as string | null | undefined) ?? null,
    dataTypeCategoryItemId: (row.data_type_category_item_id as number | null | undefined) ?? null,
    dataTypeCode: (
      row.data_type_category_code
      ?? row.data_type_code
      ?? null
    ) as CampaignInputData['dataTypeCode'],
    dataTypeName: (row.data_type_category_name as string | null | undefined) ?? null
  }
}

export function mapAccountContactFromDB(row: Record<string, unknown>): AutoAccountContact {
  return {
    id: row.id as number,
    accountId: row.account_id as number,
    contactType: row.contact_type as ContactType,
    name: row.name as string,
    uid: row.uid as string | undefined,
    url: row.url as string | undefined,
    extraData: row.extra_data as Record<string, unknown> | undefined,
    akaBizTagIds: Array.isArray(row.akabiz_tag_ids)
      ? (row.akabiz_tag_ids as unknown[]).map(Number).filter(id => Number.isFinite(id) && id > 0)
      : [],
    zaloUserId: (row.zalo_user_id as number | null | undefined) ?? null,
    zaloGroupId: (row.zalo_group_id as number | null | undefined) ?? null,
    isFriend: (row.is_friend as boolean | null | undefined) ?? null,
    requiresPostApproval: (row.requires_post_approval as boolean | null) ?? null,
    isJoined: (row.is_joined as boolean | null) ?? false,
    isDelete: row.is_delete as boolean,
    staffId: row.staff_id as number | undefined,
    organizationId: row.organization_id as number | undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  }
}

export function mapAccountContactDatasetFromDB(row: Record<string, unknown>): AutoAccountContactDataset {
  return {
    id: row.id as number,
    name: row.name as string,
    link: (row.link as string | null | undefined) ?? null,
    description: (row.description as string | null | undefined) ?? null,
    source: row.source as AutoAccountContactDataset['source'],
    accountId: (row.account_id as number | null | undefined) ?? null,
    flatformType: row.flatform_type as string,
    contactType: row.contact_type as ContactType,
    scanType: row.scan_type as AutoAccountContactDataset['scanType'],
    sourceKey: row.source_key as string,
    lastScannedAt: (row.last_scanned_at as string | null | undefined) ?? null,
    lastScanStatus: (row.last_scan_status as AutoAccountContactDataset['lastScanStatus']) ?? null,
    extraData: (row.extra_data as Record<string, unknown> | null | undefined) || {},
    contactCount: row.contact_count === null || row.contact_count === undefined
      ? undefined
      : Number(row.contact_count),
    dataTypeCategoryItemId: (row.data_type_category_item_id as number | null | undefined) ?? null,
    dataTypeCode: (
      row.data_type_category_code
      ?? row.data_type_code
      ?? null
    ) as AutoAccountContactDataset['dataTypeCode'],
    dataTypeName: (
      row.data_type_category_name
      ?? row.data_type_name
      ?? null
    ) as string | null,
    isDelete: row.is_delete as boolean,
    staffId: row.staff_id as number | undefined,
    organizationId: (row.organization_id as number | null | undefined) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  }
}

export function mapAkaBizContactTagFromDB(row: Record<string, unknown>): AkaBizContactTag {
  return {
    id: row.id as number,
    name: row.name as string,
    contactCount: row.contact_count as number | undefined,
    isDelete: row.is_delete as boolean,
    staffId: row.staff_id as number | undefined,
    organizationId: (row.organization_id as number | null | undefined) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  }
}

export function mapAccountContactGroupFromDB(row: Record<string, unknown>): AutoAccountContactGroup {
  return {
    id: row.id as number,
    accountId: row.account_id as number,
    contactType: row.contact_type as ContactType,
    purpose: (row.purpose as AutoAccountContactGroup['purpose'] | null | undefined) || 'data_group',
    name: row.name as string,
    contactCount: row.contact_count as number | undefined,
    isDelete: row.is_delete as boolean,
    staffId: row.staff_id as number | undefined,
    organizationId: row.organization_id as number | undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  }
}

function normalizeContentTemplateVariants(value: unknown): Array<{ text: string }> {
  const values = Array.isArray(value) ? value : value === null || value === undefined ? [] : [value]
  return values.flatMap(item => {
    if (typeof item === 'string') return [{ text: item }]
    if (!item || typeof item !== 'object') return []
    const text = (item as Record<string, unknown>).text
    return typeof text === 'string' ? [{ text }] : []
  })
}

function normalizeContentTemplateChannel(value: unknown): ContentTemplateChannelConfig | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  const variants = normalizeContentTemplateVariants(source.variants)
  const config: ContentTemplateChannelConfig = {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : variants.length > 0,
    variants,
    imageUrls: []
  }
  if (typeof source.formattedContentEnabled === 'boolean') {
    config.formattedContentEnabled = source.formattedContentEnabled
  }
  if (typeof source.subject === 'string') config.subject = source.subject
  if (typeof source.isHtml === 'boolean') config.isHtml = source.isHtml
  return config
}

function normalizeContentTemplateImages(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function joinedContentGroupName(row: Record<string, unknown>): string | null {
  const relation = row.content_group ?? row.auto_content_groups
  const group = Array.isArray(relation) ? relation[0] : relation
  if (!group || typeof group !== 'object') return null
  const name = (group as Record<string, unknown>).name
  return typeof name === 'string' ? name : null
}

export function mapContentTemplateFromDB(
  row: Record<string, unknown>,
  channelNameById: ReadonlyMap<string, ContentTemplateChannelName> = new Map()
): ContentTemplate {
  const channels: ContentTemplateChannels = {}
  const rawChannels = row.channels
  const rawChannelImages = row.channel_image_urls && typeof row.channel_image_urls === 'object' && !Array.isArray(row.channel_image_urls)
    ? row.channel_image_urls as Record<string, unknown>
    : {}
  if (rawChannels && typeof rawChannels === 'object' && !Array.isArray(rawChannels)) {
    for (const [id, rawConfig] of Object.entries(rawChannels as Record<string, unknown>)) {
      const channelName = channelNameById.get(id)
      if (!channelName) continue
      const config = normalizeContentTemplateChannel(rawConfig)
      if (config) {
        config.imageUrls = normalizeContentTemplateImages(rawChannelImages[id])
        channels[channelName] = config
      }
    }
  }

  return {
    id: row.id as number,
    name: row.name as string,
    groupId: (row.group_id as number | null | undefined) ?? null,
    groupName: joinedContentGroupName(row),
    channels,
    isDelete: (row.is_delete as boolean | null | undefined) ?? false,
    staffId: row.staff_id as number | undefined,
    organizationId: (row.organization_id as number | null | undefined) ?? null,
    createdAt: row.created_at as string | undefined,
    updatedAt: row.updated_at as string | undefined
  }
}

export function mapContentTemplateGroupFromDB(row: Record<string, unknown>): ContentTemplateGroup {
  return {
    id: Number(row.id),
    name: String(row.name || ''),
    description: (row.description as string | null | undefined) ?? null,
    order: Number.isFinite(Number(row.stt)) ? Number(row.stt) : 100,
    isActive: (row.is_active as boolean | null | undefined) ?? true,
    isDelete: (row.is_delete as boolean | null | undefined) ?? false,
    templateCount: Number.isFinite(Number(row.template_count)) ? Number(row.template_count) : 0,
    staffId: row.staff_id as number | undefined,
    organizationId: (row.organization_id as number | null | undefined) ?? null,
    createdAt: row.created_at as string | undefined,
    updatedAt: row.updated_at as string | undefined
  }
}

export function mapContentTemplateContentTypeFromDB(row: Record<string, unknown>): ContentTemplateContentType {
  return {
    id: Number(row.id),
    name: row.name as ContentTemplateChannelName,
    label: String(row.description || row.name || ''),
    order: Number.isFinite(Number(row.stt_by_type)) ? Number(row.stt_by_type) : 100,
    isActive: (row.is_active as boolean | null | undefined) ?? true
  }
}

export function mapMediaFileFromDB(row: Record<string, unknown>): MediaFile {
  return {
    id: row.id as number,
    provider: (row.provider as string | null | undefined) || 'r2',
    originalName: (row.original_name as string | null | undefined) || '',
    localPath: (row.local_path as string | null | undefined) ?? null,
    cloudUrl: (row.cloud_url as string | null | undefined) || '',
    objectKey: (row.object_key as string | null | undefined) ?? null,
    mimeType: (row.mime_type as string | null | undefined) ?? null,
    sizeBytes: row.size_bytes === null || row.size_bytes === undefined ? null : Number(row.size_bytes),
    isDelete: (row.is_delete as boolean | null | undefined) ?? false,
    staffId: row.staff_id as number | undefined,
    organizationId: (row.organization_id as number | null | undefined) ?? null,
    createdAt: row.created_at as string | undefined,
    updatedAt: row.updated_at as string | undefined
  }
}

export function mapMediaGroupFromDB(row: Record<string, unknown>): MediaGroup {
  return {
    id: row.id as number,
    name: (row.name as string | null | undefined) || '',
    fileCount: row.file_count === null || row.file_count === undefined ? undefined : Number(row.file_count),
    isDelete: (row.is_delete as boolean | null | undefined) ?? false,
    staffId: row.staff_id as number | undefined,
    organizationId: (row.organization_id as number | null | undefined) ?? null,
    createdAt: row.created_at as string | undefined,
    updatedAt: row.updated_at as string | undefined
  }
}

export function mapCampaignDetailFromDB(row: Record<string, unknown>): CampaignDetail {
  return {
    id: row.id as number,
    inputDataId: (row.input_data_id as number | null) ?? null,
    campaignId: row.campaign_id as number,
    accountId: row.account_id as number | undefined,
    actionCode: (row.action_code as string | null) ?? null,
    actionName: row.action_name as string,
    status: row.status as CampaignDetailStatus,
    errorCode: (row.error_code as string | null) ?? null,
    log: row.log as string | undefined,
    data: row.data as Record<string, unknown> | undefined,
    countsTowardLimit: (row.counts_toward_limit as boolean | null | undefined) ?? null,
    postUrl: row.post_url as string | undefined,
    isDelete: row.is_delete as boolean,
    createdAt: row.created_at as string
  }
}
