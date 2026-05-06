import { AutoAccount, Campaign, CampaignAction, CampaignInput, CampaignInputData, CampaignDetail, CampaignInputStatus, CampaignDetailStatus, AutoAccountContact, ContactType } from '../../shared/types'

export function mapAccountFromDB(row: Record<string, unknown>): AutoAccount {
  return {
    id: row.id as number,
    name: row.name as string,
    flatformType: row.flatform_type as string,
    loginStatus: row.login_status as string,
    status: row.status as string,
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
    isDelete: row.is_delete as boolean,
    createdAt: row.created_at as string
  }
}

export function mapCampaignFromDB(row: Record<string, unknown>): Campaign {
  return {
    id: row.id as number,
    name: row.name as string,
    actionId: row.action_id as string,
    accountId: row.account_id as number,
    status: row.status as string,
    schedule: row.schedule as string | undefined,
    scheduleType: (row.schedule_type as Campaign['scheduleType']) || 'daily',
    scheduleEndDate: row.schedule_end_date as string | undefined,
    scheduleDays: row.schedule_days as string | undefined,
    scheduleWeekDays: row.schedule_week_days as string | undefined,
    continueNextDay: (row.continue_next_day as boolean) ?? false,
    refreshData: (row.refresh_data as boolean) ?? false,
    timeSleepBetween2: row.time_sleep_between_2 as number,
    content: (row.content as string) || '',
    extraSettings: (row.extra_settings as Campaign['extraSettings']) || {},
    images: (row.images as string[]) || [],
    log: (row.log as string) || '',
    isDelete: row.is_delete as boolean,
    staffId: row.staff_id as number | undefined,
    organizationId: row.organization_id as number | undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    actionName: (row as any).auto_campaign_actions?.name as string | undefined,
    accountName: (row as any).auto_accounts?.name as string | undefined
  }
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

export function mapAccountContactFromDB(row: Record<string, unknown>): AutoAccountContact {
  return {
    id: row.id as number,
    accountId: row.account_id as number,
    contactType: row.contact_type as ContactType,
    name: row.name as string,
    uid: row.uid as string | undefined,
    url: row.url as string | undefined,
    extraData: row.extra_data as Record<string, unknown> | undefined,
    isDelete: row.is_delete as boolean,
    staffId: row.staff_id as number | undefined,
    organizationId: row.organization_id as number | undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  }
}

export function mapCampaignDetailFromDB(row: Record<string, unknown>): CampaignDetail {
  return {
    id: row.id as number,
    inputDataId: (row.input_data_id as number | null) ?? null,
    campaignId: row.campaign_id as number,
    accountId: row.account_id as number | undefined,
    actionName: row.action_name as string,
    status: row.status as CampaignDetailStatus,
    log: row.log as string | undefined,
    data: row.data as Record<string, unknown> | undefined,
    postUrl: row.post_url as string | undefined,
    isDelete: row.is_delete as boolean,
    createdAt: row.created_at as string
  }
}
