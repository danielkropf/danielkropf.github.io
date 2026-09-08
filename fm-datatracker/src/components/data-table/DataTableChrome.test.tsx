import { describe, expect, it } from 'vitest'
import { shouldCloseDataTableColumnMenuOnScroll } from './DataTableChrome'

describe('DataTableColumnMenu scroll containment', () => {
  it('keeps the menu open while its own scroll container or descendants scroll', () => {
    const menu = document.createElement('aside')
    menu.className = 'dt-table-advanced-context'
    const child = document.createElement('div')
    menu.appendChild(child)
    document.body.appendChild(menu)
    expect(shouldCloseDataTableColumnMenuOnScroll(menu)).toBe(false)
    expect(shouldCloseDataTableColumnMenuOnScroll(child)).toBe(false)
    menu.remove()
  })

  it('still closes when the page/table behind the menu scrolls', () => {
    const table = document.createElement('div')
    document.body.appendChild(table)
    expect(shouldCloseDataTableColumnMenuOnScroll(table)).toBe(true)
    expect(shouldCloseDataTableColumnMenuOnScroll(document)).toBe(true)
    table.remove()
  })
})
