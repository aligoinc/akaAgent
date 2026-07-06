import { ipcMain } from 'electron'
import { CustomerFeedbackSubmitRequest, IPC_EVENTS } from '../../../shared/types'
import { submitCustomerFeedback } from '../../services/customerFeedbackService'

export function registerCustomerFeedbackHandlers(): void {
  ipcMain.handle(IPC_EVENTS.CUSTOMER_FEEDBACK_SUBMIT, async (_, request: CustomerFeedbackSubmitRequest) => {
    return submitCustomerFeedback(request)
  })
}
