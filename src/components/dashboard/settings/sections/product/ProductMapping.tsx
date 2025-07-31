import ProductMappingTable from '@/components/dashboard/settings/sections/product/ProductMappingTable'
import { ProductMappingItemType } from '@/db/schema/qbProductSync'
import { ProductDataType, QBItemDataType } from '@/hook/useSettings'
import { ProductSettingType } from '@/type/common'
import { Checkbox, Spinner } from 'copilot-design-system'

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
    error: unknown
    isLoading: boolean
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
  if (setting.isLoading) {
    return <></>
  }

  return (
    <>
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
    </>
  )
}
