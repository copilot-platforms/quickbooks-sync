import './globals.css'
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'

import 'copilot-design-system/dist/styles/main.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'QuickBooks Sync',
  description: 'QuickBooks Sync Description',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={[inter.className].join(' ')}>
        <div className="layout-container px-8 sm:px-[100px] lg:px-[220px] pb-[54px] pt-6">
          {children}
        </div>
      </body>
    </html>
  )
}
