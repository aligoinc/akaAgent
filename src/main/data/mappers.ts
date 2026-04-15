import { FlowData, ExecutionRun, ExecutionStep, FlatformAccount, Campaign, CampaignAction, CampaignDetail, FlatformContact, ContactType, CampaignDetailAction, ElementDefinition, ActionType } from '../../shared/types'

export function mapFlowFromDB(row: Record<string, unknown>): FlowData {
  return {
    id: row.id as string,
    name: row.name as string,
    description: row.description as string,
    nodes: row.nodes as FlowData['nodes'],
    edges: row.edges as FlowData['edges'],
    variables: row.variables as Record<string, unknown>,
    inputSchema: row.input_schema as FlowData['inputSchema'],
    outputSchema: row.output_schema as FlowData['outputSchema'],
    isBlock: row.is_block as boolean,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  }
}

export function mapRunFromDB(row: Record<string, unknown>): ExecutionRun {
  return {
    id: row.id as string,
    flowId: row.flow_id as string,
    workflowId: row.workflow_id as string | undefined,
    status: row.status as ExecutionRun['status'],
    input: row.input as Record<string, unknown>,
    output: row.output as Record<string, unknown>,
    steps: [],
    startedAt: row.started_at as string,
    completedAt: row.completed_at as string,
    error: row.error as string | undefined
  }
}

export function mapRunStepFromDB(row: Record<string, unknown>): ExecutionStep {
  return {
    nodeId: row.node_id as string,
    actionType: row.action_type as ActionType,
    status: row.status as ExecutionStep['status'],
    input: row.input as Record<string, unknown>,
    output: row.output as Record<string, unknown>,
    screenshotUrl: row.screenshot_url as string | undefined,
    error: row.error as string | undefined,
    durationMs: row.duration_ms as number | undefined,
    executedAt: row.executed_at as string
  }
}

export function mapElementFromDB(row: Record<string, unknown>): ElementDefinition {
  return {
    id: row.id as string,
    name: row.name as string,
    xpath: row.xpath as string,
    description: row.description as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  }
}

export function mapAccountFromDB(row: Record<string, unknown>): FlatformAccount {
  return {
    id: row.id as number,
    name: row.name as string,
    flatformType: row.flatform_type as string,
    loginStatus: row.login_status as string,
    status: row.status as string,
    isActive: row.is_active as boolean,
    isDelete: row.is_delete as boolean,
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
    workflowId: row.workflow_id as string | undefined,
    isDelete: row.is_delete as boolean,
    createdAt: row.created_at as string
  }
}

export function mapCampaignFromDB(row: Record<string, unknown>): Campaign {
  return {
    id: row.id as number,
    name: row.name as string,
    actionId: row.action_id as string,
    flatformAccountId: row.flatform_account_id as number,
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
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    actionName: (row as any).auto_campaign_actions?.name as string | undefined,
    accountName: (row as any).auto_flatform_accounts?.name as string | undefined
  }
}

export function mapCampaignDetailFromDB(row: Record<string, unknown>): CampaignDetail {
  return {
    id: row.id as number,
    campaignId: row.campaign_id as number,
    name: row.name as string | undefined,
    phone: row.phone as string | undefined,
    uid: row.uid as string | undefined,
    email: row.email as string | undefined,
    status: row.status as string,
    note: row.note as string | undefined,
    schedule: row.schedule as string | undefined,
    dateAction: row.date_action as string | undefined,
    isDelete: row.is_delete as boolean,
    createdAt: row.created_at as string
  }
}

export function mapContactFromDB(row: Record<string, unknown>): FlatformContact {
  return {
    id: row.id as number,
    flatformAccountId: row.flatform_account_id as number,
    contactType: row.contact_type as ContactType,
    name: row.name as string,
    uid: row.uid as string | undefined,
    url: row.url as string | undefined,
    extraData: row.extra_data as Record<string, unknown> | undefined,
    isDelete: row.is_delete as boolean,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  }
}

export function mapDetailActionFromDB(row: Record<string, unknown>): CampaignDetailAction {
  return {
    id: row.id as number,
    campaignDetailId: row.campaign_detail_id as number | undefined,
    campaignId: row.campaign_id as number,
    accountId: row.account_id as number | undefined,
    actionName: row.action_name as string,
    status: row.status as string,
    log: row.log as string | undefined,
    data: row.data as Record<string, unknown> | undefined,
    isDelete: row.is_delete as boolean,
    createdAt: row.created_at as string
  }
}
