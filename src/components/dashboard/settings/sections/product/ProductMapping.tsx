import ProductMappingTable from '@/components/dashboard/settings/sections/product/ProductMappingTable'
import { SilentError } from '@/components/template/SilentError'
import Loader from '@/components/ui/Loader'
import { ProductMappingItemType } from '@/db/schema/qbProductSync'
import { ProductDataType, QBItemDataType } from '@/hook/useSettings'
import { ProductSettingType } from '@/type/common'
import { Checkbox } from 'copilot-design-system'
import { Suspense } from 'react'

export type ProductMappingComponentType = {
  openDropdowns: {
    [key: number]: boolean
  }
  setOpenDropdowns: ({}: Record<number, boolean>) => void
  searchTerms: {
    [key: number]: string
  }
  selectedItems: {
    [key: number]: Record<string, string>
  }
  toggleDropdown: (index: number) => void
  handleSearch: (index: number, value: string) => void
  selectItem: (
    index: number,
    item: Record<string, any>,
    products: ProductDataType[],
  ) => void
  getFilteredItems: (
    index: number,
    quickbooksItems: QBItemDataType[],
  ) => QBItemDataType[]
  mappingItems: ProductMappingItemType[]
  setMappingItems: (products: ProductMappingItemType[]) => void
  setting: {
    settingState: ProductSettingType
    changeSettings: (flag: keyof ProductSettingType, state: boolean) => void
  }
}

export default function ProductMapping({
  openDropdowns,
  setOpenDropdowns,
  searchTerms,
  selectedItems,
  toggleDropdown,
  handleSearch,
  selectItem,
  getFilteredItems,
  mappingItems,
  setMappingItems,
  setting,
}: ProductMappingComponentType) {
  return (
    <>
      <Suspense fallback={<Loader />}>
        <div className="mt-2 mb-6">
          <div className="mb-5">
            <Checkbox
              label="Sync Copilot products to QuickBooks"
              description="Automatically create and update QuickBooks items when products are created or used in Copilot."
              checked={setting.settingState.createNewProductFlag}
              onChange={() =>
                setting.changeSettings(
                  'createNewProductFlag',
                  !setting.settingState.createNewProductFlag,
                )
              }
            />
          </div>

          {/* Product Mapping table */}
          <ProductMappingTable
            openDropdowns={openDropdowns}
            setOpenDropdowns={setOpenDropdowns}
            searchTerms={searchTerms}
            selectedItems={selectedItems}
            toggleDropdown={toggleDropdown}
            handleSearch={handleSearch}
            selectItem={selectItem}
            getFilteredItems={getFilteredItems}
            mappingItems={mappingItems}
            setMappingItems={setMappingItems}
          />
        </div>
      </Suspense>
    </>
  )
}
