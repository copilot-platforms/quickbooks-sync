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
import {
  InvoiceSettingType,
  ProductSettingType,
  SettingType,
} from '@/type/common'

export type QuickbooksItemType = {
  Name: string
  Description?: string
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
  description: string
  price: string
  syncToken: string
  id: string
  numericPrice: number
}

export const useProductMappingSettings = () => {
  const intialProductSetting = {
    createInvoiceItemFlag: false,
    createNewProductFlag: false,
  }
  const [openDropdowns, setOpenDropdowns] = useState<{
    [key: number]: boolean
  }>({})
  const [searchTerms, setSearchTerms] = useState<{ [key: number]: string }>({})
  const [selectedItems, setSelectedItems] = useState<{
    [key: number]: Record<string, any>
  }>({})
  const [changedItemReference, setChangedItemReference] = useState<
    Record<string, any>[]
  >([])

  const [mappingItems, setMappingItems] = useState<ProductMappingItemType[]>([])
  const [settingShowConfirm, setSettingShowConfirm] = useState<boolean>(false)
  const {
    token,
    initialProductMap,
    showProductConfirm,
    setAppParams,
    itemMapped,
    initialSettingMapFlag,
  } = useApp()

  // For checkbox settings
  const [productSetting, setProductSetting] =
    useState<ProductSettingType>(intialProductSetting)
  const [intialSettingState, setIntialSettingState] = useState<
    ProductSettingType | undefined
  >()

  const {
    data: setting,
    error: settingError,
    isLoading: settingLoading,
  } = useSwrHelper(`/api/quickbooks/setting?type=product&token=${token}`)

  const changeSettings = async (
    flag: keyof ProductSettingType,
    state: boolean,
  ) => {
    setProductSetting((prev) => ({
      ...prev,
      [flag]: state,
    }))
  }

  useEffect(() => {
    if (!productSetting) return
    const showButton = !equal(intialSettingState, productSetting)
    setSettingShowConfirm(showButton)
  }, [productSetting])

  useEffect(() => {
    if (setting && setting?.setting) {
      setProductSetting(setting.setting)
      setIntialSettingState(structuredClone(setting.setting))
      setAppParams((prev) => ({
        ...prev,
        initialSettingMapFlag: setting.setting.initialSettingMap,
      }))
    }
  }, [setting])
  // End of checkbox settings

  const tableMappingSubmit = async () => {
    return await postFetcher(
      `/api/quickbooks/product/map?token=${token}`,
      {},
      { mappingItems, changedItemReference },
    )
  }

  const settingSubmit = async () => {
    return await postFetcher(
      `/api/quickbooks/setting?token=${token}`,
      {},
      { ...productSetting, type: SettingType.PRODUCT },
    )
  }

  const submitMappingItems = async () => {
    const [tableRes, settingRes] = await Promise.all([
      tableMappingSubmit(),
      settingSubmit(),
    ])

    if (tableRes && settingRes) {
      mutate(`/api/quickbooks/product/map?token=${token}`)
      mutate(`/api/quickbooks/setting?type=product&token=${token}`)
      setAppParams((prev) => ({
        ...prev,
        showProductConfirm: false,
        itemMapped: true,
      }))
      setSettingShowConfirm(false)
      setChangedItemReference([])
    } else {
      console.error({ tableRes, settingRes })
      alert('Error submitting mapping items')
    }
  }

  const cancelMappedChanges = () => {
    setSelectedItems({})
    setChangedItemReference([])
    setMappingItems(initialProductMap || [])
    setProductSetting(intialSettingState || intialProductSetting)
    setAppParams((prev) => ({
      ...prev,
      showProductConfirm: false,
    }))
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
    const fileteredChangedItem = changedItemReference.filter(
      (item) => item.id !== products[index].id,
    )
    const newVal = [
      ...fileteredChangedItem,
      Object.keys(item).length > 0
        ? { ...products[index], isExcluded: false, qbItem: item }
        : { ...products[index], isExcluded: true, qbItem: null },
    ]
    setChangedItemReference(newVal)

    // update the mapped array
    const mappedArray = mappingItems.map((mapItem) => {
      if (
        mapItem.productId === products[index].id &&
        mapItem.priceId === products[index].priceId
      ) {
        return {
          ...mapItem,
          name: item.name || null,
          description: item.description || '',
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
    cancelMappedChanges,
    toggleDropdown,
    handleSearch,
    selectItem,
    getFilteredItems,
    mappingItems,
    setMappingItems,
    showProductConfirm,
    itemMapped,
    initialSettingMapFlag,
    setting: {
      settingState: productSetting,
      changeSettings,
      error: settingError,
      isLoading: settingLoading,
      settingShowConfirm,
    },
  }
}

export const useProductTableSetting = (
  setMappingItems: (mapProducts: ProductMappingItemType[]) => void,
) => {
  const [showLoadingText, setShowLoadingText] = useState<boolean>(false)
  const emptyMappedItem = {
    name: null,
    description: '',
    priceId: null,
    productId: null,
    unitPrice: null,
    qbItemId: null,
    qbSyncToken: null,
    isExcluded: true,
  }
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
            ...emptyMappedItem,
            priceId: product.priceId,
            productId: product.id,
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
              unitPrice:
                mappedItem.unitPrice && mappedItem.unitPrice.toString(),
              qbItemId: mappedItem.qbItemId,
              qbSyncToken: mappedItem.qbSyncToken,
              isExcluded: false,
            }
          }
          return {
            ...emptyMappedItem,
            priceId: product.priceId,
            productId: product.id,
          }
        })
      }
      ProductMappingItemArraySchema.parse(newMap)
      // create deep copy of the newMap.
      if (newMap) {
        setAppParams((prev) => ({
          ...prev,
          initialProductMap: mappedItemEmpty ? [] : structuredClone(newMap), // clone the initial mapped items
          showProductConfirm: mappedItemEmpty, // allow confirm button in intial mapping
          itemMapped,
        }))
      }
      setMappingItems(newMap)
    }
  }, [products, mappedItems])

  useEffect(() => {
    const timeout = setTimeout(() => {
      setShowLoadingText(true)
    }, 3000) // As general rule, if loading takes more than 3 seconds, show loading text

    return () => {
      clearTimeout(timeout)
    }
  }, [])

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
            description: product?.Description || '',
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
    showLoadingText,
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
  const initialInvoiceSetting = {
    absorbedFeeFlag: false,
    useCompanyNameFlag: false,
  }
  const { token, setAppParams } = useApp()
  const [settingState, setSettingState] = useState<InvoiceSettingType>(
    initialInvoiceSetting,
  )
  const [showButton, setShowButton] = useState(false)
  const [intialSettingState, setIntialSettingState] = useState<
    InvoiceSettingType | undefined
  >()
  const {
    data: setting,
    error,
    isLoading,
  } = useSwrHelper(`/api/quickbooks/setting?type=invoice&token=${token}`)

  const changeSettings = async (
    flag: keyof InvoiceSettingType,
    state: boolean,
  ) => {
    setSettingState((prev) => ({
      ...prev,
      [flag]: state,
    }))
  }

  useEffect(() => {
    if (!settingState) return
    const showButton = !equal(intialSettingState, settingState)
    setShowButton(showButton)
  }, [settingState])

  useEffect(() => {
    if (setting && setting?.setting) {
      setSettingState(setting.setting)
      setIntialSettingState(structuredClone(setting.setting))
      setAppParams((prev) => ({
        ...prev,
        initialSettingMapFlag: setting.setting.initialSettingMap,
      }))
    }
  }, [setting])

  const submitInvoiceSettings = async () => {
    const res = await postFetcher(
      `/api/quickbooks/setting?token=${token}`,
      {},
      { ...settingState, type: SettingType.INVOICE },
    )
    if (!res || res?.error) {
      console.error({ res })
      alert('Error submitting invoice settings')
    } else {
      mutate(`/api/quickbooks/setting?type=invoice&token=${token}`)
      setShowButton(false)
    }
  }

  const cancelInvoiceSettings = () => {
    setShowButton(false)
    setSettingState(intialSettingState || initialInvoiceSetting)
  }

  return {
    settingState,
    changeSettings,
    submitInvoiceSettings,
    cancelInvoiceSettings,
    error,
    isLoading,
    showButton,
  }
}

export const useSettings = () => {
  const [openItems, setOpenItems] = useState<string[]>(['product-mapping'])

  return { openItems, setOpenItems }
}
