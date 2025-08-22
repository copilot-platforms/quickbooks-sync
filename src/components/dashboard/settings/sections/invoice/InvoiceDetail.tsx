import { useApp } from '@/app/context/AppContext'
import { InvoiceSettingType } from '@/type/common'
import { getWorkspaceLabel } from '@/utils/workspace'
import { Checkbox, Spinner } from 'copilot-design-system'

type InvoiceDetailProps = {
  settingState: InvoiceSettingType
  changeSettings: (flag: keyof InvoiceSettingType, state: boolean) => void
  isLoading: boolean
}

export default function InvoiceDetail({
  settingState,
  changeSettings,
  isLoading,
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
            description="Record Copilot processing fees as expenses in the 'Copilot Processing Fees' expense account in QuickBooks."
            checked={settingState.absorbedFeeFlag}
            onChange={() =>
              changeSettings('absorbedFeeFlag', !settingState.absorbedFeeFlag)
            }
          />
        </div>
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
