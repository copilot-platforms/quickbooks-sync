import { excerpt } from '@/utils/string'
import { Icon } from 'copilot-design-system'
import { useState } from 'react'

export default function ProductMappingTable() {
  const products = [
    {
      name: 'Logo Design',
      price: '$1,500',
    },
    {
      name: 'Logo Design',
      price: '$4,999.99 / yearly',
    },
    {
      name: 'Marketing Overhaul',
      price: '$18,000',
    },
    {
      name: 'Marketing Overhaul',
      price: '$2,000 / monthly',
    },
    {
      name: 'Web page',
      price: '$2,000 / yearly',
    },
    {
      name: 'Web page',
      price: '$3,000 / biannually',
    },
    {
      name: 'Web page',
      price: '$5,000 / quarterly',
    },
  ]

  const [openDropdowns, setOpenDropdowns] = useState<{
    [key: number]: boolean
  }>({})
  const [searchTerms, setSearchTerms] = useState<{ [key: number]: string }>({})
  const [selectedItems, setSelectedItems] = useState<{
    [key: number]: Record<string, string>
  }>({})

  // Sample QuickBooks items for the dropdown
  const quickbooksItems = [
    { name: 'Logo Design', price: '$1,500' },
    { name: 'Marketing Overhaul', price: '$18,000' },
    { name: 'Brand Acceleration and Digital Domination', price: '$39,999.99' },
    { name: 'Content Marketing Subscription', price: '$500' },
    { name: 'Corporate Video Package', price: '$10,000' },
    { name: 'SEO Boost', price: '$5,000' },
    { name: 'Consulting call', price: '$250' },
    {
      name: 'Brand Acceleration and Digital Domination',
      price: '$39,999.99',
    },
    { name: 'Content Marketing Subscription', price: '$500' },
  ]

  const toggleDropdown = (index: number) => {
    setOpenDropdowns((prev) => {
      // If this dropdown is already open, just close it
      if (prev[index]) {
        return {
          ...prev,
          [index]: false,
        }
      }

      // Otherwise, close all dropdowns and open only this one
      const newState = prev
      Object.keys(prev).forEach((key: string) => {
        newState[parseInt(key)] = false
      })

      return {
        ...newState,
        [index]: true,
      }
    })
  }
  const handleSearch = (index: number, value: string) => {
    setSearchTerms((prev) => ({
      ...prev,
      [index]: value,
    }))
  }

  const selectItem = (index: number, item: Record<string, string>) => {
    setSelectedItems((prev) => ({
      ...prev,
      [index]: item,
    }))
    setOpenDropdowns((prev) => ({
      ...prev,
      [index]: false,
    }))
    setSearchTerms((prev) => ({
      ...prev,
      [index]: '',
    }))
  }

  const getFilteredItems = (index: number) => {
    const searchTerm = searchTerms[index] || ''
    return quickbooksItems.filter((item) =>
      item.name.toLowerCase().includes(searchTerm.toLowerCase()),
    )
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
            {products.map((product, index) => (
              <tr key={index} className="hover:bg-gray-50 transition-colors">
                {/* Copilot Products Column */}
                <td className="py-2 pl-4 pr-3">
                  <div className="space-y-1">
                    <div className="text-sm">{product.name}</div>
                    <div className="text-sm text-gray-500">{product.price}</div>
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
                          onChange={(e) => handleSearch(index, e.target.value)}
                          className="w-full text-sm focus:outline-none focus:ring-1 focus:ring-gray-500 focus:border-gray-500"
                        />
                      </div>
                      <div className="px-3 py-2 border-1 border-card-divider">
                        <button
                          className="text-sm text-gray-700 cursor-pointer"
                          onClick={() => selectItem(index, {})}
                        >
                          Exclude from mapping
                        </button>
                      </div>
                      <div className="max-h-64 overflow-y-auto">
                        {getFilteredItems(index).map((item, itemIndex) => (
                          <button
                            key={itemIndex}
                            onClick={() =>
                              selectItem(index, {
                                name: item.name,
                                price: item.price,
                              })
                            }
                            className="w-full flex items-center justify-between px-3 py-1.5 text-sm hover:bg-gray-50 transition-colors cursor-pointer text-left"
                          >
                            <span>{excerpt(item.name, 65)}</span>
                            <span className="text-gray-500">{item.price}</span>
                          </button>
                        ))}
                        {getFilteredItems(index).length === 0 && (
                          <div className="px-3 py-2 text-sm text-gray-500">
                            No items found
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
