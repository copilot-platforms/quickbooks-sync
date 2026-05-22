import { useApp } from '@/app/context/AppContext'
import InvoiceDetail from '@/components/dashboard/settings/sections/invoice/InvoiceDetail'
import AccountMapping from '@/components/dashboard/settings/sections/account/AccountMapping'
import ProductMapping from '@/components/dashboard/settings/sections/product/ProductMapping'
import Accordion from '@/components/ui/Accordion'
import Divider from '@/components/ui/Divider'
import {
  useInvoiceDetailSettings,
  useAccountMapping,
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
  } = useProductMappingSettings()

  const { initialInvoiceSettingMapFlag, initialProductSettingMapFlag } =
    useApp()

  const {
    settingState,
    submitInvoiceSettings,
    cancelInvoiceSettings,
    isLoading,
    changeSettings,
    showButton: showInvoiceButton,
  } = useInvoiceDetailSettings()

  const {
    options: accountOptions,
    settingState: accountMappingState,
    changeSettings: changeAccountMapping,
    submitAccountMapping,
    cancelAccountMapping,
    isLoading: accountMappingIsLoading,
    error: accountMappingError,
    showButton: showAccountMappingButton,
    isDisconnected: accountMappingIsDisconnected,
  } = useAccountMapping()

  const accordionItems = [
    {
      id: 'product-mapping',
      header: 'Service Mapping',
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
    {
      id: 'account-mapping',
      header: 'Account Mapping',
      content: (
        <AccountMapping
          options={accountOptions}
          settingState={accountMappingState}
          changeSettings={changeAccountMapping}
          isLoading={accountMappingIsLoading}
          error={accountMappingError}
          isDisconnected={accountMappingIsDisconnected}
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
                    {initialProductSettingMapFlag && (
                      <Button
                        label="Cancel"
                        variant="text"
                        className="me-2"
                        onClick={cancelMappedChanges}
                      />
                    )}
                    <Button
                      label={
                        initialProductSettingMapFlag
                          ? 'Update Setting'
                          : 'Confirm'
                      }
                      variant="primary"
                      prefixIcon="Check"
                      onClick={submitMappingItems}
                    />
                  </>
                )}
              {index === 1 &&
                syncFlag &&
                (showInvoiceButton || !initialInvoiceSettingMapFlag) && (
                  <>
                    {initialInvoiceSettingMapFlag && (
                      <Button
                        label="Cancel"
                        variant="text"
                        className="me-2"
                        onClick={cancelInvoiceSettings}
                      />
                    )}
                    <Button
                      label={
                        initialInvoiceSettingMapFlag
                          ? 'Update Setting'
                          : 'Confirm'
                      }
                      variant="primary"
                      prefixIcon="Check"
                      onClick={submitInvoiceSettings}
                    />
                  </>
                )}
              {index === 2 && syncFlag && showAccountMappingButton && (
                <>
                  <Button
                    label="Cancel"
                    variant="text"
                    className="me-2"
                    onClick={cancelAccountMapping}
                  />
                  <Button
                    label="Update Setting"
                    variant="primary"
                    prefixIcon="Check"
                    onClick={submitAccountMapping}
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
