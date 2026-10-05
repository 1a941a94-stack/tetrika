import './styles.css'
import type { ReactNode } from 'react'

export const metadata = {
  title: 'Sales Call AI',
  description: 'Транскрибация и контроль качества продаж'
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="ru"><body>{children}</body></html>
}
