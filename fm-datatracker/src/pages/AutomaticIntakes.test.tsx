// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
const {query,upsert}=vi.hoisted(()=>({query:vi.fn(),upsert:vi.fn().mockResolvedValue({error:null})}))
vi.mock('../lib/paginated-query',()=>({paginatedQuery:query}))
vi.mock('../lib/supabase',()=>({supabase:{from:()=>({upsert}),auth:{getUser:async()=>({data:{user:{id:'owner'}},error:null})}}}))
import { AutomaticIntakes } from './AutomaticIntakes'
it('requires matching birth date for profile links and supports review without deleting the class',async()=>{
 query.mockResolvedValueOnce({data:[{id:'obs',cohort_key:'700:2030-09-22',checkpoint_date:'2030-09-22',source_hash:'hash',evidence:{key:'700:2030-09-22',team_id:700,club_name:'Club',intake_date:'2030-09-22',confidence:'candidate',method:'trial_42_days',expected_members:2,members:[{uid:'1',eid:1,name:'Released youth',birth_date:'2014-01-01'},{uid:'2',eid:2,name:'Known youth',birth_date:'2014-02-01'}]}}]})
 .mockResolvedValueOnce({data:[]}).mockResolvedValueOnce({data:[{id:'wrong',fm_player_id:'1',date_of_birth:'2012-01-01'},{id:'right',fm_player_id:'2',date_of_birth:'2014-02-01'}]})
 render(<MemoryRouter><AutomaticIntakes saveId="save" currentPlayers={[]}/></MemoryRouter>)
 await screen.findByText('Turma de 2030')
 fireEvent.click(screen.getByText('Turma de 2030'))
 expect(screen.queryByRole('link',{name:'Released youth'})).toBeNull()
 expect(screen.getByRole('link',{name:'Known youth'}).getAttribute('href')).toBe('/players/right')
 fireEvent.click(screen.getByRole('button',{name:'Confirmar turma'}))
 await waitFor(()=>expect(upsert).toHaveBeenCalledWith(expect.objectContaining({save_id:'save',decision:'confirmed'})))
 await screen.findByText(/Confirmada por você/)
 expect(screen.getByText('Released youth')).toBeTruthy()
})
