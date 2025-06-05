import InvoiceDetail from '@/components/dashboard/settings/sections/invoice/InvoiceDetail'
import InvoiceDetailHeader from '@/components/dashboard/settings/sections/invoice/InvoiceDetailHeader'
import ProductMapping from '@/components/dashboard/settings/sections/product/ProductMapping'
import ProductMappingHeader from '@/components/dashboard/settings/sections/product/ProductMappingHeader'
import Accordion from '@/components/ui/Accordion'
import Divider from '@/components/ui/Divider'
import { useSettings } from '@/hook/useSettings'
import { Fragment } from 'react'

export default function SettingAccordion() {
  const accordionItems = [
    {
      id: 'product-mapping',
      header: ProductMappingHeader,
      content: <ProductMapping />,
    },
    {
      id: 'invoice-detail',
      header: InvoiceDetailHeader,
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
          <Fragment key={item.id}>
            <Accordion
              item={item}
              toggleItemAction={toggleItem}
              isOpen={openItems.includes(item.id)}
            />
            {index !== accordionItems.length - 1 && <Divider />}
          </Fragment>
        )
      })}
    </div>
  )
}
