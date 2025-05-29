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
        <div className="layout-container px-8 sm:px-[100] lg:px-[220] pt-6">
          {children}
        </div>
      </body>
    </html>
  )
}
