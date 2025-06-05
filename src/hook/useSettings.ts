'use client'
import { useState } from 'react'
import { useAuth } from '@/app/context/AuthContext'
import { useSwrHelper } from '@/helper/swr.helper'
import { ProductFlattenArrayResponseType } from '@/type/dto/api.dto'
import { getTimeInterval } from '@/utils/common'
import { ProductMappingItemType } from '@/db/schema/qbProductSync'
import { postFetcher } from '@/helper/fetch.helper'

export type QuickbooksItemType = {
  Name: string
  UnitPrice: number
  Id: string
  SyncToken: string
}

export type ProductDataType = {
  id: string
  name: string
  price: string
  priceId: string
}

export type QBItemDataType = {
  name: string
  price: string
  syncToken: string
  id: string
  numericPrice: number
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

  const [mappingItems, setMappingItems] = useState<ProductMappingItemType[]>([])
  const { token } = useAuth()

  const submitMappingItems = async () => {
    const res = await postFetcher(
      `/api/quickbooks/product/map?token=${token}`,
      {},
      mappingItems,
    )
    if (!res || res?.error) {
      console.error({ res })
      alert('Error submitting mapping items') // TODO: UI toastr if error
    }
  }

  const toggleDropdown = (index: number) => {
    setOpenDropdowns((prev) => {
      // If this dropdown is already open, just close it
      if (prev[index]) {
        return {
          ...prev,
          [index]: false,
        }
      }

      // Otherwise, close all dropdowns and open only this one
      const newState = prev
      Object.keys(prev).forEach((key: string) => {
        newState[parseInt(key)] = false
      })

      return {
        ...newState,
        [index]: true,
      }
    })
  }
  const handleSearch = (index: number, value: string) => {
    setSearchTerms((prev) => ({
      ...prev,
      [index]: value,
    }))
  }

  const selectItem = (
    index: number,
    item: Record<string, any>,
    products: ProductDataType[],
  ) => {
    setSelectedItems((prev) => ({
      ...prev,
      [index]: item,
    }))
    setOpenDropdowns((prev) => ({
      ...prev,
      [index]: false,
    }))
    setSearchTerms((prev) => ({
      ...prev,
      [index]: '',
    }))

    setMappingItems((prev) => [
      ...prev,
      {
        name: item.name,
        priceId: products[index].priceId,
        productId: products[index].id,
        unitPrice: item.numericPrice.toString(),
        qbItemId: item.id,
        qbSyncToken: item.syncToken,
      },
    ])
  }

  const getFilteredItems = (
    index: number,
    quickbooksItems: QBItemDataType[],
  ) => {
    const searchTerm = searchTerms[index] || ''
    return (
      quickbooksItems &&
      quickbooksItems.filter((item) =>
        item.name.toLowerCase().includes(searchTerm.toLowerCase().trim()),
      )
    )
  }

  return {
    newlyCreatedFlag,
    setNewlyCreatedFlag,
    itemCreateFlag,
    setItemCreateFlag,
    openDropdowns,
    searchTerms,
    selectedItems,
    submitMappingItems,
    toggleDropdown,
    handleSearch,
    selectItem,
    getFilteredItems,
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
  ): ProductDataType[] | undefined => {
    return data?.products && data.products?.length > 0
      ? data.products.map((product) => {
          // convert amount to dollar
          const price = new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
          }).format(product.amount / 100)
          const newPrice = `${price} ${product?.interval && product?.intervalCount ? `/ ${getTimeInterval(product.interval, product.intervalCount)}` : ''}`
          return {
            id: product.id,
            name: product.name,
            price: newPrice,
            numericPrice: product.amount,
            priceId: product.priceId,
          }
        })
      : undefined
  }

  const formatQBItemForListing = (
    data: QuickbooksItemType[],
  ): QBItemDataType[] | undefined => {
    return data && data?.length > 0
      ? data.map((product) => {
          const price = new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
          }).format(product.UnitPrice)
          const newPrice = `${price}`
          return {
            id: product.Id,
            name: product.Name,
            price: newPrice,
            numericPrice: product.UnitPrice * 100,
            syncToken: product.SyncToken,
          }
        })
      : undefined
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
