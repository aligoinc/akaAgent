import type { AutoAccount } from '../../../shared/types'

export const isZaloWebAccount = (account: Pick<AutoAccount, 'flatformType' | 'isZaloShowWeb'>): boolean => (
  account.flatformType === 'zalo' && account.isZaloShowWeb === true
)

export const getAccountPlatformLabel = (
  account: Pick<AutoAccount, 'flatformType' | 'isZaloShowWeb'>
): string => {
  switch (account.flatformType) {
    case 'facebook': return 'Facebook'
    case 'zalo': return isZaloWebAccount(account) ? 'Zalo (trình duyệt)' : 'Zalo (mã QR)'
    case 'email': return 'Email'
    case 'sms': return 'SMS'
    default: return account.flatformType
  }
}
