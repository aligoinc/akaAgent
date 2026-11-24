export const MESSAGE_OPT_OUT_CUSTOMERS_IPC = 'settings:message-opt-out-customers:list'
export const MESSAGE_OPT_OUT_CUSTOMERS_PAGE_SIZE = 50

export interface MessageOptOutCustomerQuery {
  search?: string
  page?: number
}

export interface MessageOptOutCustomer {
  id: string
  phone: string | null
  email: string | null
  /** Dòng của kênh SMS / email / Facebook (V649) không có mã Zalo. */
  zaloGlobalId: string | null
  /** Kênh của link (V649). DB cũ không trả = Zalo. */
  channel?: 'zalo' | 'sms' | 'email' | 'facebook'
  /** Khoá người nhận Facebook (uid:… / user:… / page:…:…), chỉ dòng kênh Facebook. */
  facebookKey?: string | null
  zaloName: string | null
  zaloAvatar: string | null
  confirmedAt: string
  sourceCampaignId: number | null
  sourceCampaignName: string | null
  sourceDetailId: number | null
  sourceSentAt: string | null
  sourceActionName: string | null
  sourceStatus: string | null
}

export interface MessageOptOutCustomerPage {
  items: MessageOptOutCustomer[]
  total: number
  page: number
  pageSize: number
}
