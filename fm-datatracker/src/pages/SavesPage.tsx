import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { CustomSelect } from '../components/CustomSelect'
import { useSaves } from '../features/saves/SaveContext'
import {
  createTrackedClub,
  loadClubCatalog,
  setTrackedClubActive,
  trackSaveClub,
} from '../lib/longitudinal-service'
import {
  canDeactivateTrackedClub,
  orderedTrackedClubs,
  untrackedClubCandidates,
} from '../lib/multiclub-tracking'
import type { Club, Save, TrackedClub } from '../types/domain'

function errorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : 'Falha inesperada ao atualizar a rede de clubes.'
}

export function SavesPage() {
  const { saves, selected, select, refresh, create, deleteSave } = useSaves()
  const navigate = useNavigate()
  const selectedIdRef = useRef<string | null>(selected?.id ?? null)
  selectedIdRef.current = selected?.id ?? null

  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState<Save | null>(null)
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
  const [deleteError, setDeleteError] = useState('')
  const [deleteBusy, setDeleteBusy] = useState(false)

  const [clubCatalog, setClubCatalog] = useState<Club[]>([])
  const [clubCatalogLoading, setClubCatalogLoading] = useState(false)
  const [clubBusy, setClubBusy] = useState(false)
  const [clubError, setClubError] = useState('')
  const [candidateClubId, setCandidateClubId] = useState('')
  const [newClubName, setNewClubName] = useState('')
  const [newClubCountry, setNewClubCountry] = useState('')

  const trackedClubs = useMemo(
    () => orderedTrackedClubs(selected?.structure?.trackedClubs ?? []),
    [selected?.structure?.trackedClubs],
  )
  const candidates = useMemo(
    () => untrackedClubCandidates(clubCatalog, trackedClubs),
    [clubCatalog, trackedClubs],
  )

  useEffect(() => {
    let active = true
    const saveId = selected?.id
    setCandidateClubId('')
    setClubError('')
    setClubBusy(false)
    if (!saveId) {
      setClubCatalog([])
      setClubCatalogLoading(false)
      return () => { active = false }
    }
    setClubCatalogLoading(true)
    void loadClubCatalog(saveId)
      .then(catalog => {
        if (active && selectedIdRef.current === saveId) setClubCatalog(catalog)
      })
      .catch(cause => {
        if (active && selectedIdRef.current === saveId) setClubError(errorMessage(cause))
      })
      .finally(() => {
        if (active && selectedIdRef.current === saveId) setClubCatalogLoading(false)
      })
    return () => { active = false }
  }, [selected?.id])

  useEffect(() => {
    if (candidateClubId && !candidates.some(club => club.id === candidateClubId)) setCandidateClubId('')
  }, [candidateClubId, candidates])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const form = new FormData(event.currentTarget)
    const createError = await create({
      name: String(form.get('name')),
      club_name: String(form.get('club')),
      country: String(form.get('country')),
    })
    setBusy(false)
    if (createError) setError(createError)
    else navigate('/')
  }

  function requestDelete(save: Save) {
    setDeleting(save)
    setDeleteConfirmation('')
    setDeleteError('')
  }

  function closeDelete() {
    if (deleteBusy) return
    setDeleting(null)
    setDeleteConfirmation('')
    setDeleteError('')
  }

  async function confirmDelete() {
    if (!deleting || deleteConfirmation !== deleting.name) return
    setDeleteBusy(true)
    setDeleteError('')
    const deleteSaveError = await deleteSave(deleting.id)
    setDeleteBusy(false)
    if (deleteSaveError) {
      setDeleteError(deleteSaveError)
      return
    }
    setDeleting(null)
    setDeleteConfirmation('')
  }

  async function mutateClubs(action: (saveId: string) => Promise<void>) {
    const saveId = selected?.id
    if (!saveId || clubBusy) return
    setClubBusy(true)
    setClubError('')
    try {
      await action(saveId)
      await refresh()
      if (selectedIdRef.current === saveId) {
        const catalog = await loadClubCatalog(saveId)
        if (selectedIdRef.current === saveId) setClubCatalog(catalog)
      }
    } catch (cause) {
      if (selectedIdRef.current === saveId) setClubError(errorMessage(cause))
    } finally {
      if (selectedIdRef.current === saveId) setClubBusy(false)
    }
  }

  function toggleTrackedClub(item: TrackedClub) {
    if (!canDeactivateTrackedClub(item) && item.is_active) return
    void mutateClubs(saveId => setTrackedClubActive(saveId, item.club_id, !item.is_active))
  }

  function addKnownClub() {
    if (!candidateClubId) return
    const clubId = candidateClubId
    void mutateClubs(async saveId => {
      await trackSaveClub(saveId, clubId)
      setCandidateClubId('')
    })
  }

  function createManualClub(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = newClubName.trim()
    if (!name) return
    const country = newClubCountry.trim()
    void mutateClubs(async saveId => {
      await createTrackedClub(saveId, { name, country })
      setNewClubName('')
      setNewClubCountry('')
    })
  }

  return <>
    <div className="title-row"><div><span className="eyebrow">LINHAS HISTÓRICAS</span><h1>Saves</h1></div></div>
    <div className="grid">
      <form className="card form-grid" onSubmit={submit}>
        <h2>Criar save</h2>
        <label>Nome do save<input name="name" required /></label>
        <label>Clube<input name="club" required /></label>
        <label>País<input name="country" /></label>
        <button disabled={busy}>{busy ? 'Criando…' : 'Criar save'}</button>
        {error && <p className="error">{error}</p>}
      </form>

      <section className="card">
        <div className="save-management-heading">
          <div><h2>Seus saves</h2><p>Selecione um save para trabalhar ou gerencie os que não deseja mais manter.</p></div>
          <span>{saves.length}</span>
        </div>
        {saves.length ? <div className="save-management-list">{saves.map(save => <div className={`save-management-row ${selected?.id === save.id ? 'selected' : ''}`} key={save.id}>
          <button className="save-item" onClick={() => select(save)} type="button">
            <strong>{save.name}</strong><span>{save.club_name}{save.current_season ? ` · ${save.current_season}` : ''}</span>
          </button>
          <button className="save-delete-trigger" type="button" onClick={() => requestDelete(save)} aria-label={`Excluir save ${save.name}`} title="Excluir save">Excluir</button>
        </div>)}</div> : <p>Nenhum save criado.</p>}
      </section>
    </div>

    <section className="card multiclub-workspace">
      <div className="save-management-heading">
        <div>
          <span className="eyebrow">REDE DO SAVE</span>
          <h2>Clubes acompanhados</h2>
          <p>Clubes são entidades do save. Elencos como Principal, B e Base continuam sendo grupos internos de cada clube.</p>
        </div>
        <span>{trackedClubs.filter(item => item.is_active).length}</span>
      </div>

      {!selected ? <p>Selecione um save para gerenciar sua rede de clubes.</p> : <>
        {selected.structure?.diagnostic && <p className="multiclub-diagnostic">{selected.structure.diagnostic}</p>}
        <div className="multiclub-tracked-list">
          {trackedClubs.map(item => <div className={`multiclub-club-row ${item.is_active ? '' : 'is-inactive'}`} key={item.id}>
            <div className="multiclub-club-copy">
              <strong>{item.club.name}</strong>
              <span>{item.club.country || 'País não informado'}{item.club.fm_club_id ? ` · FM ${item.club.fm_club_id}` : ''}</span>
            </div>
            <div className="multiclub-club-actions">
              {item.tracking_role === 'primary' ? <span className="multiclub-role-badge">Principal</span> : <span className="multiclub-role-badge secondary">Acompanhado</span>}
              {item.tracking_role === 'primary'
                ? <button type="button" className="ghost" disabled title="O clube principal do save não pode ser desativado">Ativo</button>
                : <button type="button" className="ghost" disabled={clubBusy} onClick={() => toggleTrackedClub(item)}>{item.is_active ? 'Parar de acompanhar' : 'Reativar'}</button>}
            </div>
          </div>)}
          {!trackedClubs.length && !clubCatalogLoading && <p>Nenhum Club normalizado foi carregado para este save.</p>}
        </div>

        <div className="multiclub-add-grid">
          <div className="multiclub-add-panel">
            <h3>Acompanhar clube conhecido</h3>
            <p>Use um Club já identificado no histórico deste save. Clubes inativos são reativados na lista acima.</p>
            <div className="multiclub-inline-form">
              <CustomSelect
                ariaLabel="Clube conhecido"
                value={candidateClubId}
                options={candidates.map(club => ({ value: club.id, label: `${club.name}${club.country ? ` · ${club.country}` : ''}` }))}
                onChange={setCandidateClubId}
                placeholder={clubCatalogLoading ? 'Carregando clubes…' : candidates.length ? 'Selecione um clube' : 'Nenhum clube disponível'}
                disabled={clubBusy || clubCatalogLoading || !candidates.length}
                disabledReason={!candidates.length ? 'Todos os Clubs conhecidos já possuem vínculo de acompanhamento.' : undefined}
              />
              <button type="button" disabled={clubBusy || !candidateClubId} onClick={addKnownClub}>Acompanhar</button>
            </div>
          </div>

          <form className="multiclub-add-panel" onSubmit={createManualClub}>
            <h3>Criar clube manual</h3>
            <p>Cria um novo Club explícito. O nome não é usado para mesclar automaticamente registros existentes.</p>
            <label>Nome<input value={newClubName} onChange={event => setNewClubName(event.target.value)} disabled={clubBusy} required /></label>
            <label>País<input value={newClubCountry} onChange={event => setNewClubCountry(event.target.value)} disabled={clubBusy} /></label>
            <button disabled={clubBusy || !newClubName.trim()}>{clubBusy ? 'Atualizando…' : 'Criar e acompanhar'}</button>
          </form>
        </div>
        {clubError && <p className="error multiclub-error">{clubError}</p>}
      </>}
    </section>

    {deleting && <div className="save-delete-overlay" role="presentation" onMouseDown={closeDelete}>
      <section className="save-delete-modal" role="dialog" aria-modal="true" aria-labelledby="delete-save-title" onMouseDown={event => event.stopPropagation()}>
        <span className="eyebrow">EXCLUSÃO PERMANENTE</span>
        <h2 id="delete-save-title">Excluir “{deleting.name}”?</h2>
        <p>Todos os jogadores, snapshots, imports, táticas, planejamento, contratos, notas e demais dados vinculados a este save serão apagados permanentemente.</p>
        <p>Para confirmar, digite exatamente o nome do save:</p>
        <label><strong>{deleting.name}</strong><input autoFocus value={deleteConfirmation} onChange={event => setDeleteConfirmation(event.target.value)} disabled={deleteBusy} /></label>
        {deleteError && <p className="error">{deleteError}</p>}
        <div className="save-delete-actions">
          <button className="ghost" type="button" onClick={closeDelete} disabled={deleteBusy}>Cancelar</button>
          <button className="save-delete-confirm" type="button" onClick={() => void confirmDelete()} disabled={deleteBusy || deleteConfirmation !== deleting.name}>{deleteBusy ? 'Excluindo…' : 'Excluir permanentemente'}</button>
        </div>
      </section>
    </div>}
  </>
}
