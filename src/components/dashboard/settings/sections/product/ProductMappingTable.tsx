import { ProductMappingComponentType } from '@/components/dashboard/settings/sections/product/ProductMapping'
import { useProductTableSetting } from '@/hook/useSettings'
import { excerpt } from '@/utils/string'
import { Icon, Spinner } from 'copilot-design-system'

export default function ProductMappingTable({
  openDropdowns,
  searchTerms,
  selectedItems,
  toggleDropdown,
  handleSearch,
  selectItem,
  getFilteredItems,
}: ProductMappingComponentType) {
  const { products, quickbooksItems, isLoading, error } =
    useProductTableSetting()

  if (error) {
    // TODO: if error show in proper UI
    console.error({ error })
  }

  return (
    <>
      <div className="bg-white border border-gray-200 text-left">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="pt-5 pr-3 pl-4 pb-2 text-xs uppercase font-normal tracking-wide w-[46.5%]">
                COPILOT PRODUCTS
              </th>

              <th className="pt-5 pr-3 pl-4 pb-2 border-l border-gray-200 w-[7%]">
                <Icon
                  icon="ArrowRight"
                  width={16}
                  height={16}
                  className="text-gray-500 mx-auto"
                />
              </th>
              <th className="pt-5 pr-3 pl-4 pb-2 text-left text-xs uppercase font-normal tracking-wide border-l border-gray-200 w-[46.5%]">
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
                    <div className="space-y-1">
                      <div className="text-sm">{product.name}</div>
                      <div className="text-sm text-gray-500">
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
                  <td className="py-2 pl-4 pr-3 border-l border-gray-200 bg-gray-100 relative">
                    <button
                      onClick={() => toggleDropdown(index)}
                      className="w-full h-full flex items-center justify-between hover:bg-gray-50 transition-colors"
                    >
                      {selectedItems[index] &&
                      Object.keys(selectedItems[index]).length > 0 ? (
                        <div className="space-y-1 text-left">
                          <div className="text-sm">
                            {selectedItems[index].name}
                          </div>
                          <div className="text-sm text-gray-500">
                            {selectedItems[index].price}
                          </div>
                        </div>
                      ) : (
                        '--'
                      )}

                      <Icon
                        icon="ChevronDown"
                        width={16}
                        height={16}
                        className={`text-gray-500 transition-transform ${openDropdowns[index] ? 'rotate-180' : ''}`}
                      />
                    </button>

                    {openDropdowns[index] && (
                      <div className="absolute top-full left-0 right-0 bg-white border border-gray-200 shadow-lg round-md z-100 min-w-[320px]">
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
                  <a href="#" className="ms-2">
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
