import ProductMappingTable from '@/components/dashboard/settings/sections/product/ProductMappingTable'
import { useProductMappingSettings } from '@/hook/useSettings'
import { Checkbox } from 'copilot-design-system'

export default function ProductMapping() {
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
        <ProductMappingTable />
      </div>
    </>
  )
}
