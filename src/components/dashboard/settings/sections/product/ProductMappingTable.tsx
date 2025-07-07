import { ProductMappingComponentType } from '@/components/dashboard/settings/sections/product/ProductMapping'
import { ProductMappingItemType } from '@/db/schema/qbProductSync'
import { useMapItem, useProductTableSetting } from '@/hook/useSettings'
import DropDownIcon from '@/components/ui/DropDownIcon'
import { excerpt } from '@/utils/string'
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
        <div className="space-y-1 text-left">
          <div className="text-sm">{currentlyMapped?.name}</div>
          <div className="text-sm text-gray-500">
            {currentlyMapped.unitPrice &&
              `$${parseInt(currentlyMapped.unitPrice) / 100}`}
          </div>
        </div>
      ) : (
        <div className="py-1">
          <Icon icon="Dash" width={16} height={16} className="text-gray-600" />
        </div>
      )}
    </>
  )
}

export default function ProductMappingTable({
  openDropdowns,
  searchTerms,
  selectedItems,
  toggleDropdown,
  handleSearch,
  selectItem,
  getFilteredItems,
  mappingItems,
  setMappingItems,
}: Omit<ProductMappingComponentType, 'setting'>) {
  const { products, quickbooksItems, isLoading, error } =
    useProductTableSetting(setMappingItems)

  if (error) {
    // TODO: if error show in proper UI
    console.error({ error })
  }

  return (
    <>
      <div className="product-mapping-table bg-white border border-gray-200 text-left">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="pt-5 pr-3 pl-4 pb-2 text-[11px] uppercase font-normal tracking-[1px] leading-3 w-[46.5%] lg:w-[372px]">
                COPILOT PRODUCTS
              </th>

              <th className="pt-5 pr-3 pl-4 pb-2 border-l border-gray-200 w-[7%] lg:w-[56px]">
                <Icon
                  icon="ArrowRight"
                  width={16}
                  height={16}
                  className="text-gray-500 mx-auto aspect-square"
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
                  <div className="flex justify-center">
                    <Spinner size={5} />
                  </div>
                </td>
              </tr>
            ) : products ? (
              products.map((product, index) => (
                <tr key={index} className="hover:bg-gray-50 transition-colors">
                  {/* Copilot Products Column */}
                  <td className="py-2 pl-4 pr-3">
                    <div className="">
                      <div className="text-sm leading-5">{product.name}</div>
                      <div className="text-sm leading-5 text-gray-500">
                        {product.price}
                      </div>
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
                  <td className="border-l border-gray-200 bg-gray-100 relative">
                    <button
                      onClick={() => toggleDropdown(index)}
                      className="w-full h-full flex items-center justify-between hover:bg-gray-50 transition-colors py-4 pl-4 pr-3"
                    >
                      {selectedItems[index] &&
                      Object.keys(selectedItems[index]).length > 0 ? (
                        <div className="text-left">
                          <div className="text-sm">
                            {selectedItems[index].name}
                          </div>
                          <div className="text-sm text-gray-500">
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
                      <DropDownIcon
                        isOpen={openDropdowns[index]}
                        className={`text-gray-500`}
                      />
                    </button>

                    {openDropdowns[index] && (
                      <div className="absolute right-0 left-[-145px] top-full md:left-0 md:right-0 bg-white border border-gray-200 shadow-xl rounded-sm z-100 md:min-w-[320px]">
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
                        <div className="px-3 py-2 border-1 border-card-divider">
                          <button
                            className="text-sm text-gray-700 cursor-pointer"
                            onClick={() => selectItem(index, {}, products)}
                          >
                            Exclude from mapping
                          </button>
                        </div>
                        <div className="max-h-64 overflow-y-auto">
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
                                        price: item.price,
                                        syncToken: item.syncToken,
                                        numericPrice: item.numericPrice,
                                      },
                                      products,
                                    )
                                  }
                                  className="w-full flex items-center justify-between px-3 py-1.5 text-sm hover:bg-gray-50 transition-colors cursor-pointer text-left"
                                >
                                  <span>{excerpt(item.name, 65)}</span>
                                  <span className="text-gray-500">
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
