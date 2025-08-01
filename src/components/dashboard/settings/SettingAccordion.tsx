import InvoiceDetail from '@/components/dashboard/settings/sections/invoice/InvoiceDetail'
import ProductMapping from '@/components/dashboard/settings/sections/product/ProductMapping'
import Accordion from '@/components/ui/Accordion'
import Divider from '@/components/ui/Divider'
import {
  useInvoiceDetailSettings,
  useProductMappingSettings,
  useSettings,
} from '@/hook/useSettings'
import { Button } from 'copilot-design-system'

export default function SettingAccordion({
  syncFlag,
}: {
  syncFlag: boolean | null
}) {
  const {
    openDropdowns,
    setOpenDropdowns,
    searchTerms,
    selectedItems,
    toggleDropdown,
    handleSearch,
    selectItem,
    getFilteredItems,
    submitMappingItems,
    cancelMappedChanges,
    mappingItems,
    setMappingItems,
    showProductConfirm,
    setting,
    initialSettingMapFlag,
    itemMapped,
  } = useProductMappingSettings()

  const {
    settingState,
    submitInvoiceSettings,
    cancelInvoiceSettings,
    isLoading,
    changeSettings,
    showButton: showInvoiceButton,
  } = useInvoiceDetailSettings()

  const accordionItems = [
    {
      id: 'product-mapping',
      header: 'Product Mapping',
      content: (
        <ProductMapping
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
          setting={setting}
        />
      ),
    },
    {
      id: 'invoice-detail',
      header: 'Invoice Details',
      content: (
        <InvoiceDetail
          settingState={settingState}
          changeSettings={changeSettings}
          isLoading={isLoading}
        />
      ),
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
            <div
              className={`absolute top-[14px] right-0 z-10 flex items-center justify-end`}
            >
              {index === 0 &&
                syncFlag &&
                (showProductConfirm || setting.settingShowConfirm) && (
                  <>
                    {!initialSettingMapFlag && (
                      <Button
                        label="Cancel"
                        variant="text"
                        className="me-2"
                        onClick={cancelMappedChanges}
                      />
                    )}
                    <Button
                      label={itemMapped ? 'Update Setting' : 'Confirm'}
                      variant="primary"
                      prefixIcon="Check"
                      onClick={submitMappingItems}
                    />
                  </>
                )}
              {index === 1 && syncFlag && showInvoiceButton && (
                <>
                  {!initialSettingMapFlag && (
                    <Button
                      label="Cancel"
                      variant="text"
                      className="me-2"
                      onClick={cancelInvoiceSettings}
                    />
                  )}
                  <Button
                    label={
                      !initialSettingMapFlag ? 'Update Setting' : 'Confirm'
                    }
                    variant="primary"
                    prefixIcon="Check"
                    onClick={submitInvoiceSettings}
                  />
                </>
              )}
            </div>
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
