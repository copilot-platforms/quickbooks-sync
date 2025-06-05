'use client'
import { useState } from 'react'
import { useAuth } from '@/app/context/AuthContext'
import { useSwrHelper } from '@/helper/swr.helper'
import { ProductFlattenArrayResponseType } from '@/type/dto/api.dto'
import { getTimeInterval } from '@/utils/common'

export type QuickbooksItemType = {
  Name: string
  UnitPrice: number
  Id: string
}

export const useProductMappingSettings = () => {
  const [newlyCreatedFlag, setNewlyCreatedFlag] = useState(false)
  const [itemCreateFlag, setItemCreateFlag] = useState(false)

  const [openDropdowns, setOpenDropdowns] = useState<{
    [key: number]: boolean
  }>({})
  const [searchTerms, setSearchTerms] = useState<{ [key: number]: string }>({})
  const [selectedItems, setSelectedItems] = useState<{
    [key: number]: Record<string, string>
  }>({})

  return {
    newlyCreatedFlag,
    setNewlyCreatedFlag,
    itemCreateFlag,
    setItemCreateFlag,
    openDropdowns,
    setOpenDropdowns,
    searchTerms,
    setSearchTerms,
    selectedItems,
    setSelectedItems,
  }
}

export const useProductTableSetting = () => {
  const { token } = useAuth()
  const {
    data: products,
    error: productError,
    isLoading: isProductLoading,
  } = useSwrHelper(`/api/quickbooks/product/flatten?token=${token}`)

  const {
    data: quickbooksItems,
    error: quickbooksError,
    isLoading: isQBLoading,
  } = useSwrHelper(`/api/quickbooks/product/qb/item?token=${token}`)

  const isLoading = isProductLoading || isQBLoading
  const error = productError || quickbooksError

  const formatProductDataForListing = (
    data: ProductFlattenArrayResponseType,
  ) => {
    return (
      data?.products &&
      data.products?.length > 0 &&
      data.products.map((product) => {
        // convert amount to dollar
        const price = new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD',
        }).format(product.amount / 100)
        const newPrice = `$${price} ${product?.interval && product?.intervalCount ? `/ ${getTimeInterval(product.interval, product.intervalCount)}` : ''}`
        return {
          id: product.id,
          name: product.name,
          price: newPrice,
        }
      })
    )
  }

  const formatQBItemForListing = (data: QuickbooksItemType[]) => {
    return (
      data &&
      data?.length > 0 &&
      data.map((product) => {
        // convert amount to dollar
        const price = new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD',
        }).format(product.UnitPrice)
        const newPrice = `$${price}`
        return {
          id: product.Id,
          name: product.Name,
          price: newPrice,
        }
      })
    )
  }

  return {
    products: formatProductDataForListing(products),
    quickbooksItems: formatQBItemForListing(quickbooksItems),
    isLoading,
    error,
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

export const useSettings = () => {
  const [openItems, setOpenItems] = useState<string[]>(['product-mapping'])

  return { openItems, setOpenItems }
}
