import ProductMappingTable from '@/components/dashboard/settings/sections/product/ProductMappingTable'
import {
  ProductDataType,
  QBItemDataType,
  useProductMappingSettings,
} from '@/hook/useSettings'
import { Checkbox } from 'copilot-design-system'

export type ProductMappingComponentType = {
  openDropdowns: {
    [key: number]: boolean
  }
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
}

export default function ProductMapping({
  openDropdowns,
  searchTerms,
  selectedItems,
  toggleDropdown,
  handleSearch,
  selectItem,
  getFilteredItems,
}: ProductMappingComponentType) {
  const {
    newlyCreatedFlag,
    itemCreateFlag,
    setNewlyCreatedFlag,
    setItemCreateFlag,
  } = useProductMappingSettings()

  return (
    <>
      <div className="mt-2 mb-6">
        <div className="mb-5">
          <Checkbox
            label="Add newly created products to Quickbooks"
            description="Automatically create matching items in QuickBooks with product name,
            description, and price when new products are created in Copilot."
            checked={newlyCreatedFlag}
            onChange={() => setNewlyCreatedFlag(!newlyCreatedFlag)}
          />
        </div>
        <div className="mb-5">
          <Checkbox
            label="Create an item in QuickBooks if Copilot product is not found"
            description="Create missing QuickBooks items when syncing invoices containing
            Copilot products that don't yet exist in QuickBooks."
            checked={itemCreateFlag}
            onChange={() => setItemCreateFlag(!itemCreateFlag)}
          />
        </div>

        {/* Product Mapping table */}
        <ProductMappingTable
          openDropdowns={openDropdowns}
          searchTerms={searchTerms}
          selectedItems={selectedItems}
          toggleDropdown={toggleDropdown}
          handleSearch={handleSearch}
          selectItem={selectItem}
          getFilteredItems={getFilteredItems}
        />
      </div>
    </>
  )
}
