import InvoiceDetail from '@/components/dashboard/settings/sections/invoice/InvoiceDetail'
import ProductMapping from '@/components/dashboard/settings/sections/product/ProductMapping'
import Accordion from '@/components/ui/Accordion'
import Divider from '@/components/ui/Divider'
import { useProductMappingSettings, useSettings } from '@/hook/useSettings'
import { Button } from 'copilot-design-system'

export default function SettingAccordion() {
  const {
    openDropdowns,
    searchTerms,
    selectedItems,
    toggleDropdown,
    handleSearch,
    selectItem,
    getFilteredItems,
    submitMappingItems,
  } = useProductMappingSettings()

  const accordionItems = [
    {
      id: 'product-mapping',
      header: 'Product Mapping',
      content: (
        <ProductMapping
          openDropdowns={openDropdowns}
          searchTerms={searchTerms}
          selectedItems={selectedItems}
          toggleDropdown={toggleDropdown}
          handleSearch={handleSearch}
          selectItem={selectItem}
          getFilteredItems={getFilteredItems}
        />
      ),
    },
    {
      id: 'invoice-detail',
      header: 'Invoice Details',
      content: <InvoiceDetail />,
    },
  ]
  const { openItems, setOpenItems } = useSettings()

  const toggleItem = (itemId: string) => {
    setOpenItems((prev) =>
      prev.includes(itemId)
        ? prev.filter((id) => id !== itemId)
        : [...prev, itemId],
    )
  }

  return (
    <div className="mx-auto">
      {accordionItems.map((item, index) => {
        return (
          <div key={item.id} className="relative">
            {index === 0 && (
              <div
                className={`absolute top-[14px] right-0 z-10 flex items-center justify-end`}
              >
                <Button
                  label="Confirm"
                  variant="primary"
                  prefixIcon="Check"
                  onClick={submitMappingItems}
                />
              </div>
            )}
            <Accordion
              item={item}
              toggleItemAction={toggleItem}
              isOpen={openItems.includes(item.id)}
            />
            {index !== accordionItems.length - 1 && <Divider />}
          </div>
        )
      })}
    </div>
  )
}
