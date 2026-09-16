// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { aggregateImportProgress, ImportProgressRing } from './ImportProgressRing'
afterEach(cleanup)
it('averages completed stages without treating review or errors as completed', () => {
 expect(aggregateImportProgress([{phase:'done'}, {phase:'reading',progress:40}])).toEqual({pending:1,value:70,complete:false})
 expect(aggregateImportProgress([{phase:'ready',progress:80}]).complete).toBe(false)
 expect(aggregateImportProgress([{phase:'attention',progress:95}]).complete).toBe(false)
 expect(aggregateImportProgress([{phase:'done'}])).toEqual({pending:0,value:100,complete:true})
})
it('renders a determinate arc and replaces the count with a check only on success', () => {
 const view=render(<ImportProgressRing value={42} center={2} label="Progresso" />)
 expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('42')
 expect(screen.getByText('2')).toBeTruthy()
 view.rerender(<ImportProgressRing value={100} complete center={0} label="Progresso" />)
 expect(screen.getByText('✓')).toBeTruthy()
 expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100')
})
