import { useApp } from '@/app/context/AppContext'
import AccountSelect from '@/components/dashboard/settings/sections/account/AccountSelect'
import { AccountOption, InvoiceSettingType } from '@/type/common'
import { getWorkspaceLabel } from '@/utils/workspace'
import { Checkbox, Spinner } from 'copilot-design-system'

type InvoiceDetailProps = {
  settingState: InvoiceSettingType
  changeSettings: <K extends keyof InvoiceSettingType>(
    flag: K,
    value: InvoiceSettingType[K],
  ) => void
  isLoading: boolean
  bankDepositEnabled: boolean
  bankAccountOptions: AccountOption[] | undefined
  bankAccountsError: unknown
}

export default function InvoiceDetail({
  settingState,
  changeSettings,
  isLoading,
  bankDepositEnabled,
  bankAccountOptions,
  bankAccountsError,
}: InvoiceDetailProps) {
  const { workspace } = useApp()

  if (isLoading) {
    return <Spinner size={5} />
  }

  return (
    <>
      <div className="mt-2 mb-6">
        <div className="mb-5">
          <Checkbox
            label="Add absorbed fees to an Expense Account in QuickBooks"
            description="Record Assembly processing fees as expenses in the 'Assembly Processing Fees' expense account in QuickBooks."
            checked={settingState.absorbedFeeFlag}
            onChange={() =>
              changeSettings('absorbedFeeFlag', !settingState.absorbedFeeFlag)
            }
          />
        </div>
        {/* Bank deposit UI is gated behind the AB rollout allowlist. */}
        {bankDepositEnabled && (
          <>
            <div className="mb-5">
              <Checkbox
                label="Create bank deposits for automatic bank reconciliation"
                description="When Stripe pays out, create a QuickBooks bank deposit that matches the net amount deposited to your bank (after fees), so the bank transaction matches automatically."
                checked={settingState.bankDepositFeeFlag}
                onChange={() =>
                  changeSettings(
                    'bankDepositFeeFlag',
                    !settingState.bankDepositFeeFlag,
                  )
                }
              />
            </div>
            {settingState.bankDepositFeeFlag && (
              <div className="mb-5 ml-6">
                {bankAccountsError ? (
                  <p className="text-xs text-red-600">
                    Could not load bank accounts. Reload to retry.
                  </p>
                ) : (
                  <>
                    <AccountSelect
                      label="Deposit bank account"
                      description="The bank account Stripe payouts are deposited into. Used to create the matching QuickBooks bank deposit."
                      value={settingState.bankAccountRef ?? ''}
                      options={bankAccountOptions}
                      placeholder="Select a deposit bank account"
                      onChange={(id) => changeSettings('bankAccountRef', id)}
                    />
                    {bankAccountOptions !== undefined &&
                      !settingState.bankAccountRef && (
                        <p className="text-xs text-red-600">
                          Select a deposit bank account to enable bank deposits.
                        </p>
                      )}
                  </>
                )}
              </div>
            )}
          </>
        )}
        <div className="mb-6">
          <Checkbox
            label={`Use ${getWorkspaceLabel(workspace).groupTerm} name when syncing invoices billed to ${getWorkspaceLabel(workspace).groupTermPlural}`}
            description={`Create QuickBooks customers using the ${getWorkspaceLabel(workspace).groupTerm} name rather than individual ${getWorkspaceLabel(workspace).individualTerm} names when invoices are billed to ${getWorkspaceLabel(workspace).groupTermPlural}.`}
            checked={settingState.useCompanyNameFlag}
            onChange={() =>
              changeSettings(
                'useCompanyNameFlag',
                !settingState.useCompanyNameFlag,
              )
            }
          />
        </div>
      </div>
    </>
  )
}
