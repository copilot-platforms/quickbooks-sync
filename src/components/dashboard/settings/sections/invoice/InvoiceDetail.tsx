import { useInvoiceDetailSettings } from '@/hook/useSettings'
import { Checkbox } from 'copilot-design-system'

export default function InvoiceDetail() {
  const {
    absorbedFeeFlag,
    setAbsorbedFeeFlag,
    companyNameFlag,
    setCompanyNameFlag,
  } = useInvoiceDetailSettings()

  return (
    <>
      <div className="mt-2 mb-6">
        <div className="mb-5">
          <Checkbox
            label="Add absorbed fees to an Expense Account in QuickBooks"
            description="Record Copilot processing fees as expenses in the 'Copilot Fees' expense account in QuickBooks."
            checked={absorbedFeeFlag}
            onChange={() => setAbsorbedFeeFlag(!absorbedFeeFlag)}
          />
        </div>
        <div className="mb-6">
          <Checkbox
            label="Use company name when syncing invoices billed to companies"
            description="Create QuickBooks customers using the company name rather than individual client names when invoices are billed to organizations."
            checked={companyNameFlag}
            onChange={() => setCompanyNameFlag(!companyNameFlag)}
          />
        </div>
      </div>
    </>
  )
}
