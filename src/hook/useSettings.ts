import { useState } from 'react'

export const useProductMappingSettings = () => {
  const [newlyCreatedFlag, setNewlyCreatedFlag] = useState(false)
  const [itemCreateFlag, setItemCreateFlag] = useState(false)

  return {
    newlyCreatedFlag,
    setNewlyCreatedFlag,
    itemCreateFlag,
    setItemCreateFlag,
  }
}

export const useInvoiceDetailSettings = () => {
  const [absorbedFeeFlag, setAbsorbedFeeFlag] = useState(false)
  const [companyNameFlag, setCompanyNameFlag] = useState(false)

  return {
    absorbedFeeFlag,
    setAbsorbedFeeFlag,
    companyNameFlag,
    setCompanyNameFlag,
  }
}
