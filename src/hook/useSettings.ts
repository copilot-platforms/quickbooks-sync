'use client'
import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@/app/context/AppContext'
import { useSwrHelper } from '@/helper/swr.helper'
import {
  ProductFlattenArrayResponseType,
  ProductFlattenResponseType,
} from '@/type/dto/api.dto'
import { QBO_ITEM_NAME_MAX_LENGTH } from '@/utils/string'
import { ProductMappingItemType } from '@/db/schema/qbProductSync'
import { patchFetcher, postFetcher } from '@/helper/fetch.helper'
import { mutate } from 'swr'
import equal from 'deep-equal'
import {
  AccountOption,
  InvoiceSettingType,
  ProductSettingType,
  SettingType,
} from '@/type/common'
import { postMessage as postMessageBridge } from '@/bridge/header'

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
  description?: string
  isNameTooLong: boolean
}

export type QBItemDataType = {
  name: string
  description: string
  syncToken: string
  id: string
}

export const useProductMappingSettings = () => {
  const intialProductSetting = {
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
  const { token, initialProductMap, showProductConfirm, setAppParams } =
    useApp()

  // For checkbox settings
  const [productSetting, setProductSetting] =
    useState<ProductSettingType>(intialProductSetting)
  const [intialSettingState, setIntialSettingState] = useState<
    ProductSettingType | undefined
  >()

  const { data: setting } = useSwrHelper(
    `/api/quickbooks/setting?type=${SettingType.PRODUCT}&token=${token}`,
  )

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
    if (!productSetting || !intialSettingState) return
    const showButton = !equal(intialSettingState, productSetting)
    setSettingShowConfirm(showButton)
  }, [productSetting])

  useEffect(() => {
    if (setting && setting?.setting) {
      setProductSetting(setting.setting)
      setIntialSettingState(structuredClone(setting.setting))
      setAppParams((prev) => ({
        ...prev,
        initialInvoiceSettingMapFlag:
          setting.setting?.initialInvoiceSettingMap || false,
        initialProductSettingMapFlag:
          setting.setting?.initialProductSettingMap || false,
        enableAppIndicator:
          (setting.setting.initialInvoiceSettingMap &&
            setting.setting.initialProductSettingMap) ||
          false,
      }))
    }
  }, [setting])
  // End of checkbox settings

  const tableMappingSubmit = async () => {
    return await postFetcher(
      `/api/quickbooks/product/map?token=${token}`,
      {},
      { mappingItems, changedItemReference },
      { timeoutMs: null },
    )
  }

  const settingSubmit = async () => {
    return await postFetcher(
      `/api/quickbooks/setting?type=${SettingType.PRODUCT}&token=${token}`,
      {},
      { ...productSetting, type: SettingType.PRODUCT },
      { timeoutMs: null },
    )
  }

  const submitMappingItems = async () => {
    setAppParams((prev) => ({
      ...prev,
      showProductConfirm: false,
    }))
    setSettingShowConfirm(false)
    try {
      await Promise.all([tableMappingSubmit(), settingSubmit()])
      mutate(`/api/quickbooks/product/map?token=${token}`)
      mutate(
        `/api/quickbooks/setting?type=${SettingType.PRODUCT}&token=${token}`,
      )
      setChangedItemReference([])
    } catch (err) {
      setSettingShowConfirm(true) // show the update settings button if error
      console.error('Error submitting product settings', err)
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
      return {
        [index]: !prev[index],
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
      (item) => item.id !== products[index]?.id,
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
      if (mapItem.productId === products[index]?.id) {
        return {
          ...mapItem,
          name: item.name || null,
          description: item.description || '',
          productId: products[index].id,
          unitPrice: null,
          copilotName: products[index].name,
          qbItemId: item.id || null,
          qbSyncToken: item.syncToken || null,
          isExcluded: item.id && item.syncToken ? false : true,
        }
      }
      return mapItem
    })

    setAppParams((prev) => ({
      ...prev,
      showProductConfirm:
        initialProductMap?.length === 0 || // show confirm button if initial product map is empty
        !equal(initialProductMap, mappedArray),
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
    setOpenDropdowns,
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
    setting: {
      settingState: productSetting,
      changeSettings,
      settingShowConfirm,
    },
  }
}

function formatProductDataForListing(
  data: ProductFlattenArrayResponseType,
): ProductDataType[] | undefined {
  return data?.products?.length
    ? data.products.map((product) => ({
        id: product.id,
        name: product.name,
        description: product.description || '',
        isNameTooLong: product.name.length > QBO_ITEM_NAME_MAX_LENGTH,
      }))
    : undefined
}

function formatQBItemForListing(
  data: QuickbooksItemType[],
): QBItemDataType[] | undefined {
  return data?.length
    ? data.map((product) => {
        return {
          id: product.Id,
          name: product.Name,
          description: product?.Description || '',
          syncToken: product.SyncToken,
        }
      })
    : undefined
}

export const useProductTableSetting = (
  setMappingItems: (mapProducts: ProductMappingItemType[]) => void,
) => {
  const emptyMappedItem = {
    name: null,
    description: '',
    productId: null,
    unitPrice: null,
    qbItemId: null,
    qbSyncToken: null,
    isExcluded: true,
  }
  const { token, setAppParams, syncFlag } = useApp()
  const { data: products } = useSwrHelper(
    `/api/quickbooks/product/flatten?token=${token}`,
  )

  const { data: quickbooksItems } = useSwrHelper(
    syncFlag ? `/api/quickbooks/product/qb/item?token=${token}` : null,
  )

  const { data: mappedItems } = useSwrHelper(
    `/api/quickbooks/product/map?token=${token}`,
  )

  useEffect(() => {
    let newMap: ProductMappingItemType[]
    const mappedItemEmpty =
      !mappedItems || Object.keys(mappedItems).length === 0
    if (products) {
      if (mappedItemEmpty) {
        // if mapped list is empty, exclude all items by default
        newMap = products?.products?.map(
          (product: ProductFlattenResponseType) => {
            return {
              ...emptyMappedItem,
              productId: product.id,
              copilotName: product.name,
            }
          },
        )
      } else {
        newMap = products?.products?.map(
          (product: ProductFlattenResponseType) => {
            const mappedItem = mappedItems.find(
              // search for the already mapped product from the mapped list
              (item: ProductMappingItemType) =>
                item.productId === product.id && item.qbItemId,
            )
            if (mappedItem) {
              // if found, return with the mapped product in mapping item
              return {
                name: mappedItem.name,
                description: mappedItem.description,
                productId: product.id,
                unitPrice: null,
                qbItemId: mappedItem.qbItemId,
                qbSyncToken: mappedItem.qbSyncToken,
                copilotName: product.name,
                isExcluded: false,
              }
            }
            return {
              ...emptyMappedItem,
              productId: product.id,
              copilotName: product.name,
            }
          },
        )
      }
      // ProductMappingItemArraySchema.parse(newMap)
      // create deep copy of the newMap.
      if (newMap) {
        setAppParams((prev) => ({
          ...prev,
          initialProductMap: mappedItemEmpty ? [] : structuredClone(newMap), // clone the initial mapped items
          showProductConfirm: mappedItemEmpty, // allow confirm button in intial mapping
        }))
      }
      setMappingItems(newMap)
    }
  }, [products, mappedItems, quickbooksItems])

  const handleCopilotProductCreate = () => {
    const payload = {
      type: 'history.push',
      route: 'products.create',
    }
    postMessageBridge(payload)
  }

  const { formattedProducts, hasLongProductName } = useMemo(() => {
    const formatted = formatProductDataForListing(products)
    return {
      formattedProducts: formatted,
      hasLongProductName:
        formatted?.some((product) => product.isNameTooLong) ?? false,
    }
  }, [products])

  return {
    products: formattedProducts,
    quickbooksItems: formatQBItemForListing(quickbooksItems),
    handleCopilotProductCreate,
    hasLongProductName,
  }
}

export const useMapItem = (
  mappingItems: ProductMappingItemType[] | undefined,
  productId: string,
  qbItems: QBItemDataType[] | undefined,
) => {
  const [currentlyMapped, setCurrentlyMapped] = useState<
    { name: string } | undefined
  >()
  const checkIfMappedItemExists = () => {
    const currentMapItem = mappingItems?.find((item) => {
      return item.productId === productId && item.qbItemId
    })
    const currentQbItem = qbItems?.find((item) => {
      return item.id === currentMapItem?.qbItemId
    })

    let itemToReturn: { name: string } | undefined
    const itemName = currentQbItem?.name || currentMapItem?.name

    if (itemName) {
      itemToReturn = { name: itemName }
    }

    setCurrentlyMapped(itemToReturn)
    return itemToReturn
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
    bankDepositFeeFlag: false,
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
    if (!settingState || !intialSettingState) return
    const showButton = !equal(intialSettingState, settingState)
    setShowButton(showButton)
  }, [settingState])

  useEffect(() => {
    if (setting && setting?.setting) {
      setSettingState(setting.setting)
      setIntialSettingState(structuredClone(setting.setting))
      setAppParams((prev) => ({
        ...prev,
        initialInvoiceSettingMapFlag: setting.setting.initialInvoiceSettingMap,
        initialProductSettingMapFlag: setting.setting.initialProductSettingMap,
        enableAppIndicator:
          setting.setting.initialInvoiceSettingMap &&
          setting.setting.initialProductSettingMap,
      }))
    }
  }, [setting])

  const submitInvoiceSettings = async () => {
    setShowButton(false)
    try {
      await postFetcher(
        `/api/quickbooks/setting?type=${SettingType.INVOICE}&token=${token}`,
        {},
        { ...settingState, type: SettingType.INVOICE },
        { timeoutMs: null },
      )
      mutate(`/api/quickbooks/setting?type=invoice&token=${token}`)
    } catch (err) {
      setShowButton(true) // show the update settings button if error
      console.error('Error submitting Invoice settings', err)
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

export type AccountMappingState = {
  incomeAccountRef: string
  expenseAccountRef: string
  assetAccountRef: string
}

export type AccountsListResponseUi = {
  options: {
    income: AccountOption[]
    expense: AccountOption[]
    asset: AccountOption[]
  }
  selected: AccountMappingState
}

export const useAccountMapping = () => {
  const { token, syncFlag, portalConnectionStatus } = useApp()
  // Skip the /accounts fetch when QB isn't connected or sync is off — the
  // endpoint requires a live portal connection and would 404 otherwise.
  const isDisconnected = !syncFlag || !portalConnectionStatus
  const [settingState, setSettingState] = useState<AccountMappingState>({
    incomeAccountRef: '',
    expenseAccountRef: '',
    assetAccountRef: '',
  })
  const [showButton, setShowButton] = useState(false)
  const [initialState, setInitialState] = useState<
    AccountMappingState | undefined
  >()

  const { data, error, isLoading } = useSwrHelper<AccountsListResponseUi>(
    isDisconnected ? null : `/api/quickbooks/accounts?token=${token}`,
    // Override the shared suspense default: keep loading/error state inline
    // to this accordion section so the dashboard doesn't fall back to the
    // page-level loading.tsx full-screen spinner on first open.
    { suspense: false, revalidateOnMount: true },
  )

  useEffect(() => {
    if (data?.selected) {
      setSettingState(data.selected)
      setInitialState(structuredClone(data.selected))
    }
  }, [data])

  useEffect(() => {
    if (!initialState) return
    setShowButton(!equal(initialState, settingState))
  }, [settingState, initialState])

  const changeSettings = (field: keyof AccountMappingState, value: string) => {
    setSettingState((prev) => ({ ...prev, [field]: value }))
  }

  const submitAccountMapping = async () => {
    if (!initialState) return
    setShowButton(false)
    try {
      // Send only changed fields to keep the PATCH minimal.
      const payload: Partial<AccountMappingState> = {}
      if (settingState.incomeAccountRef !== initialState.incomeAccountRef)
        payload.incomeAccountRef = settingState.incomeAccountRef
      if (settingState.expenseAccountRef !== initialState.expenseAccountRef)
        payload.expenseAccountRef = settingState.expenseAccountRef
      if (settingState.assetAccountRef !== initialState.assetAccountRef)
        payload.assetAccountRef = settingState.assetAccountRef

      await patchFetcher(
        `/api/quickbooks/accounts?token=${token}`,
        { 'content-type': 'application/json' },
        payload,
        { timeoutMs: null },
      )
      mutate(`/api/quickbooks/accounts?token=${token}`)
      setInitialState(structuredClone(settingState))
    } catch (err) {
      setShowButton(true)
      console.error('Error submitting Account Mapping settings', err)
    }
  }

  const cancelAccountMapping = () => {
    setShowButton(false)
    if (initialState) setSettingState(initialState)
  }

  return {
    options: data?.options,
    settingState,
    changeSettings,
    submitAccountMapping,
    cancelAccountMapping,
    error,
    isLoading,
    showButton,
    isDisconnected,
  }
}

export const useSettings = () => {
  const { isEnabled } = useApp()
  const [openItems, setOpenItems] = useState<string[]>(
    isEnabled
      ? ['product-mapping']
      : ['product-mapping', 'invoice-detail', 'account-mapping'],
  )

  return { openItems, setOpenItems }
}
