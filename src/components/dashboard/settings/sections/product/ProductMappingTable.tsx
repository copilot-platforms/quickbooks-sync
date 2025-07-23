import { ProductMappingComponentType } from '@/components/dashboard/settings/sections/product/ProductMapping'
import { ProductMappingItemType } from '@/db/schema/qbProductSync'
import useClickOutside from '@/hook/useClickOutside'
import {
  ProductDataType,
  useMapItem,
  useProductTableSetting,
} from '@/hook/useSettings'
import { Icon, Spinner } from 'copilot-design-system'

const MapItemComponent = ({
  mappingItems,
  productId,
  priceId,
}: {
  mappingItems: ProductMappingItemType[] | undefined
  productId: string
  priceId: string
}) => {
  const { currentlyMapped } = useMapItem(mappingItems, productId, priceId)
  return (
    <>
      {currentlyMapped ? (
        <div className="text-left">
          <div className="text-sm leading-5">{currentlyMapped?.name}</div>
          <div className="text-body-xs leading-5 text-gray-500">
            {currentlyMapped.unitPrice &&
              new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: 'USD',
              }).format(
                currentlyMapped.unitPrice
                  ? parseFloat(currentlyMapped.unitPrice) / 100
                  : 0,
              )}
          </div>
        </div>
      ) : (
        <div className="py-2">
          <Icon icon="Dash" width={16} height={16} className="text-gray-600" />
        </div>
      )}
    </>
  )
}

export default function ProductMappingTable({
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
}: Omit<ProductMappingComponentType, 'setting'>) {
  const { products, quickbooksItems, isLoading, error, showLoadingText } =
    useProductTableSetting(setMappingItems)

  if (error) {
    // TODO: if error show in proper UI
    console.error({ error })
  }

  const dropdownRef = useClickOutside<HTMLDivElement>(() => {
    setOpenDropdowns({})
  })

  return (
    <>
      <div className="product-mapping-table bg-white border border-gray-200 text-left">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="pt-5 pr-3 pl-4 pb-2 text-[11px] uppercase font-normal tracking-[1px] leading-3 w-[46.5%] lg:w-[372px]">
                COPILOT PRODUCTS
              </th>

              <th className="pt-4 px-5 pb-2 border-l border-gray-200 w-[7%] lg:w-[56px] text-center">
                <Icon
                  icon="ArrowRight"
                  width={16}
                  height={16}
                  className="text-gray-500"
                />
              </th>
              <th className="pt-5 pr-3 pl-4 pb-2 text-left text-[11px] uppercase font-normal tracking-[1px] leading-3 border-l border-gray-200 w-[46.5%] lg:w-[372px]">
                QUICKBOOKS ITEMS
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {isLoading ? (
              <tr>
                <td colSpan={3} className="py-11">
                  <div className="flex flex-col items-center justify-center space-y-2.5">
                    <Spinner size={5} />
                    <p
                      className={`text-gray-600 leading-5.5 text-sm ${
                        showLoadingText ? 'visible' : 'invisible'
                      }`}
                    >
                      Syncing with QuickBooks
                    </p>
                  </div>
                </td>
              </tr>
            ) : products ? (
              products.map((product: ProductDataType, index: number) => (
                <tr key={index} className="transition-colors">
                  {/* Copilot Products Column */}
                  <td className="py-2 pl-4 pr-3">
                    <div className="text-sm leading-5 text-gray-600">
                      {product.name}
                    </div>
                    <div className="text-body-xs leading-5 text-gray-500">
                      {product.price}
                    </div>
                  </td>

                  {/* Arrow Column */}
                  <td className="border-l border-gray-200 text-center">
                    <Icon
                      icon="ArrowRight"
                      width={16}
                      height={16}
                      className="text-gray-500 mx-auto"
                    />
                  </td>

                  {/* QuickBooks Items Column */}
                  <td className="border-l border-gray-200 bg-gray-100 hover:bg-gray-150 relative">
                    <button
                      onClick={() => toggleDropdown(index)}
                      className="w-full h-full grid grid-cols-6 md:grid-cols-14 transition-colors py-2 pl-4 pr-3"
                    >
                      <div className="col-span-5 md:col-span-13 text-left">
                        {selectedItems[index] &&
                        Object.keys(selectedItems[index]).length > 0 ? (
                          <div className="text-left">
                            <div className="text-sm leading-5 text-gray-600">
                              {selectedItems[index].name}
                            </div>
                            <div className="text-body-xs leading-5 text-gray-500">
                              {selectedItems[index].price}
                            </div>
                          </div>
                        ) : (
                          <MapItemComponent
                            mappingItems={mappingItems}
                            productId={product.id}
                            priceId={product.priceId}
                          />
                        )}
                      </div>
                      <div className="col-span-1 ml-auto my-auto">
                        <Icon
                          icon="ChevronDown"
                          width={16}
                          height={16}
                          className={`text-gray-500`}
                        />
                      </div>
                    </button>

                    {openDropdowns[index] && (
                      <div
                        ref={dropdownRef}
                        className="absolute right-[-1px] left-[-145px] top-full mt-[-4px] md:left-[-1px] bg-white border border-gray-150 !shadow-popover-050 rounded-sm z-100 md:min-w-[320px]"
                      >
                        <div className="px-3 py-2">
                          <input
                            type="text"
                            placeholder="Search"
                            value={searchTerms[index] || ''}
                            onChange={(e) =>
                              handleSearch(index, e.target.value)
                            }
                            className="w-full text-sm focus:outline-none focus:ring-1 focus:ring-gray-500 focus:border-gray-500"
                          />
                        </div>
                        <div className="border-t-1 border-b-1 border-card-divider hover:bg-gray-100">
                          <button
                            className="w-full h-full text-left  px-3 py-2 text-sm text-gray-600 cursor-pointer"
                            onClick={() => selectItem(index, {}, products)}
                          >
                            Exclude from mapping
                          </button>
                        </div>
                        <div className="max-h-56 overflow-y-auto">
                          {quickbooksItems &&
                            getFilteredItems(index, quickbooksItems).map(
                              (item, itemIndex) => (
                                <button
                                  key={itemIndex}
                                  onClick={() =>
                                    selectItem(
                                      index,
                                      {
                                        id: item.id,
                                        name: item.name,
                                        description: item.description,
                                        price: item.price,
                                        syncToken: item.syncToken,
                                        numericPrice: item.numericPrice,
                                      },
                                      products,
                                    )
                                  }
                                  className="w-full flex items-center justify-between px-3 py-1.5 text-sm hover:bg-gray-100 transition-colors cursor-pointer text-left"
                                >
                                  <span className="text-gray-600 line-clamp-1">
                                    {item.name}
                                  </span>
                                  <span className="text-gray-500 text-body-micro leading-body-micro">
                                    {item.price}
                                  </span>
                                </button>
                              ),
                            )}
                          {(!quickbooksItems ||
                            getFilteredItems(index, quickbooksItems).length ===
                              0) && (
                            <div className="px-3 py-2 text-sm text-gray-500">
                              No items found
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              ))
            ) : (
              <tr className="text-center">
                <td colSpan={3} className="py-11">
                  Start by creating a product in Copilot.
                  <a href="#" className="ms-2 text-blue-300">
                    Create Product
                  </a>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}
