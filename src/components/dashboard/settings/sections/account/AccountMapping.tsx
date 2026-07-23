import { AccountsListResponseUi, AccountMappingState } from '@/hook/useSettings'
import AccountSelect from '@/components/dashboard/settings/sections/account/AccountSelect'
import { Spinner } from 'copilot-design-system'

type AccountMappingProps = {
  options: AccountsListResponseUi['options'] | undefined
  settingState: AccountMappingState
  changeSettings: (field: keyof AccountMappingState, value: string) => void
  isLoading: boolean
  error: unknown
  isDisconnected: boolean
}

export default function AccountMapping({
  options,
  settingState,
  changeSettings,
  isLoading,
  error,
  isDisconnected,
}: AccountMappingProps) {
  if (isDisconnected) {
    return (
      <div className="mt-2 mb-6 text-sm text-gray-600">
        Connect to QuickBooks to manage account settings.
      </div>
    )
  }

  if (isLoading) return <Spinner size={5} />

  if (error) {
    return (
      <div className="mt-2 mb-6 text-sm text-red-600">
        Could not load accounts. Reload to retry.
      </div>
    )
  }

  return (
    <div className="mt-2 mb-6">
      <AccountSelect
        label="Income account"
        description="Default income account assigned to services synced from Assembly to QuickBooks."
        value={settingState.incomeAccountRef}
        options={options?.income}
        placeholder="Select an income account"
        onChange={(id) => changeSettings('incomeAccountRef', id)}
      />
      <AccountSelect
        label="Expense account"
        description="Account where absorbed invoice payment fees are recorded as expenses in QuickBooks."
        value={settingState.expenseAccountRef}
        options={options?.expense}
        placeholder="Select an expense account"
        onChange={(id) => changeSettings('expenseAccountRef', id)}
      />
      <AccountSelect
        label="Bank account"
        description="Account the absorbed invoice payment fees are paid out of, paired with the expense account above."
        value={settingState.assetAccountRef}
        options={options?.asset}
        placeholder="Select a bank account"
        onChange={(id) => changeSettings('assetAccountRef', id)}
      />
    </div>
  )
}
