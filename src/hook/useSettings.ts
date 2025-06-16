'use client'
import { useEffect, useState } from 'react'
import { useApp } from '@/app/context/AppContext'
import { useSwrHelper } from '@/helper/swr.helper'
import { ProductFlattenArrayResponseType } from '@/type/dto/api.dto'
import { getTimeInterval } from '@/utils/common'
import {
  ProductMappingItemArraySchema,
  ProductMappingItemType,
} from '@/db/schema/qbProductSync'
import { postFetcher } from '@/helper/fetch.helper'
import { mutate } from 'swr'
import equal from 'deep-equal'

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
  description?: string
}

export type QBItemDataType = {
  name: string
  price: string
  syncToken: string
  id: string
  numericPrice: number
}

export const useProductMapping = () => {
  const [newlyCreatedFlag, setNewlyCreatedFlag] = useState(false)
  const [itemCreateFlag, setItemCreateFlag] = useState(false)

  return {
    newlyCreatedFlag,
    setNewlyCreatedFlag,
    itemCreateFlag,
    setItemCreateFlag,
  }
}

export const useProductMappingSettings = () => {
  const [openDropdowns, setOpenDropdowns] = useState<{
    [key: number]: boolean
  }>({})
  const [searchTerms, setSearchTerms] = useState<{ [key: number]: string }>({})
  const [selectedItems, setSelectedItems] = useState<{
    [key: number]: Record<string, string>
  }>({})

  const [mappingItems, setMappingItems] = useState<ProductMappingItemType[]>([])
  const { token, initialProductMap, showProductConfirm, setAppParams } =
    useApp()

  const submitMappingItems = async () => {
    const res = await postFetcher(
      `/api/quickbooks/product/map?token=${token}`,
      {},
      mappingItems,
    )
    if (!res || res?.error) {
      console.error({ res })
      alert('Error submitting mapping items') // TODO: UI toastr if error
    } else {
      mutate(`/api/quickbooks/product/map?token=${token}`)
      setAppParams((prev) => ({
        ...prev,
        showProductConfirm: false,
        itemMapped: true,
      }))
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

    // update the mapped array
    const mappedArray = mappingItems.map((mapItem) => {
      if (
        mapItem.productId === products[index].id &&
        mapItem.priceId === products[index].priceId
      ) {
        return {
          ...mapItem,
          name: item.name || null,
          description: products[index].description || '',
          priceId: products[index].priceId,
          productId: products[index].id,
          unitPrice: item.numericPrice?.toString() || null,
          qbItemId: item.id || null,
          qbSyncToken: item.syncToken || null,
          isExcluded: item.id && item.syncToken ? false : true,
        }
      }
      return mapItem
    })

    setAppParams((prev) => ({
      ...prev,
      showProductConfirm: !equal(initialProductMap, mappedArray),
    }))
    setMappingItems(mappedArray)
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
    openDropdowns,
    searchTerms,
    selectedItems,
    submitMappingItems,
    toggleDropdown,
    handleSearch,
    selectItem,
    getFilteredItems,
    mappingItems,
    setMappingItems,
    showProductConfirm,
  }
}

export const useProductTableSetting = (
  setMappingItems: (mapProducts: ProductMappingItemType[]) => void,
) => {
  const { token, setAppParams } = useApp()
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

  const {
    data: mappedItems,
    error: mappedItemsError,
    isLoading: isMappedItemsLoading,
  } = useSwrHelper(`/api/quickbooks/product/map?token=${token}`)

  const isLoading = isProductLoading || isQBLoading || isMappedItemsLoading
  const error = productError || quickbooksError || mappedItemsError

  useEffect(() => {
    let newMap: ProductMappingItemType[],
      itemMapped = false
    const mappedItemEmpty =
      !mappedItems || Object.keys(mappedItems).length === 0
    if (products && !isLoading) {
      if (mappedItemEmpty) {
        // if mapped list is empty, exclude all items by default
        newMap = products?.products?.map((product: ProductDataType) => {
          return {
            name: null,
            description: product.description,
            priceId: product.priceId,
            productId: product.id,
            unitPrice: null,
            qbItemId: null,
            qbSyncToken: null,
            isExcluded: true,
          }
        })
      } else {
        itemMapped = true
        newMap = products?.products?.map((product: ProductDataType) => {
          const mappedItem = mappedItems.find(
            // search for the already mapped product from the mapped list
            (item: ProductMappingItemType) =>
              item.productId === product.id &&
              item.priceId === product.priceId &&
              item.qbItemId,
          )
          if (mappedItem) {
            // if found, return with the mapped product in mapping item
            return {
              name: mappedItem.name,
              description: mappedItem.description,
              priceId: product.priceId,
              productId: product.id,
              unitPrice: mappedItem.unitPrice,
              qbItemId: mappedItem.qbItemId,
              qbSyncToken: mappedItem.qbSyncToken,
              isExcluded: false,
            }
          }
          return {
            name: null,
            description: product.description,
            priceId: product.priceId,
            productId: product.id,
            unitPrice: null,
            qbItemId: null,
            qbSyncToken: null,
            isExcluded: true,
          }
        })
      }
      ProductMappingItemArraySchema.parse(newMap)
      // create deep copy of the newMap.
      if (newMap) {
        setAppParams((prev) => ({
          ...prev,
          initialProductMap: mappedItemEmpty ? [] : structuredClone(newMap), // allow confirm if not product mapping in intial state
          showProductConfirm: mappedItemEmpty, // allow confirm if not product mapping in intial state
          itemMapped,
        }))
      }
      setMappingItems(newMap)
    }
  }, [products, mappedItems])

  const formatProductDataForListing = (
    data: ProductFlattenArrayResponseType,
  ): ProductDataType[] | undefined => {
    return data?.products?.length
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
            description: product.description || '',
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
    return data?.length
      ? data.map((product) => {
          const price = new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
          }).format(product.UnitPrice)
          return {
            id: product.Id,
            name: product.Name,
            price: price,
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

export const useMapItem = (
  mappingItems: ProductMappingItemType[] | undefined,
  productId: string,
  priceId: string,
) => {
  const [currentlyMapped, setCurrentlyMapped] = useState<
    ProductMappingItemType | undefined
  >()
  const checkIfMappedItemExists = () => {
    const currentMapItem = mappingItems?.find((item) => {
      return (
        item.productId === productId &&
        item.priceId === priceId &&
        item.qbItemId
      )
    })
    setCurrentlyMapped(currentMapItem)
    return currentMapItem
  }

  useEffect(() => {
    if (mappingItems) checkIfMappedItemExists()
  }, [mappingItems])

  return {
    currentlyMapped,
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
