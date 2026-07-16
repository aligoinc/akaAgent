import type {
  Automation,
  AutomationCampaignOption,
  AutomationContactGroupOption,
  AutomationDataType,
  AutomationDelayUnit,
  AutomationExecution,
  AutomationExecutionListQuery,
  AutomationExecutionListResult,
  AutomationInput,
  AutomationListQuery,
  AutomationListResult,
  AutomationOptions,
  AutomationScheduleMode,
  AutomationSortField,
  AutomationTriggerCondition,
  AutomationTriggerOption,
  AutomationUpdatedEvent
} from '../../../../shared/types'

export type {
  Automation,
  AutomationCampaignOption,
  AutomationContactGroupOption,
  AutomationDataType,
  AutomationDelayUnit,
  AutomationExecution,
  AutomationExecutionListQuery,
  AutomationExecutionListResult,
  AutomationInput,
  AutomationListQuery,
  AutomationListResult,
  AutomationOptions,
  AutomationScheduleMode,
  AutomationSortField,
  AutomationTriggerCondition,
  AutomationTriggerOption,
  AutomationUpdatedEvent
}

export type AutomationDetail = AutomationExecution
export type AutomationDetailListQuery = AutomationExecutionListQuery
export type AutomationDetailListResult = AutomationExecutionListResult
export type AutomationMutation = AutomationInput

export interface AutomationElectronApi {
  listAutomations: (query?: AutomationListQuery) => Promise<AutomationListResult>
  getAutomation: (id: number) => Promise<Automation>
  getAutomationOptions: () => Promise<AutomationOptions>
  createAutomation: (data: AutomationInput) => Promise<Automation>
  updateAutomation: (id: number, data: AutomationInput) => Promise<Automation>
  setAutomationActive: (id: number, isActive: boolean) => Promise<Automation>
  deleteAutomation: (id: number) => Promise<void>
  listAutomationDetails: (automationId: number, query?: AutomationExecutionListQuery) => Promise<AutomationExecutionListResult>
  onAutomationUpdated: (callback: (payload: AutomationUpdatedEvent) => void) => (() => void)
}

export const getAutomationApi = (): AutomationElectronApi => (
  window.electronAPI as unknown as AutomationElectronApi
)
