export function Resources() {
  const base = import.meta.env.BASE_URL
  return <section className="resources-page"><h2>Views para exportação</h2><p>Instale estas views no Football Manager 26 para exportar arquivos compatíveis com o DataTracker.</p><div className="resource-grid"><a className="card resource-download" href={`${base}views/PlayerExport Atributes.fmf`} download><strong>PlayerExport Attributes</strong><span>Atributos e informações do jogador</span><b>Baixar .fmf</b></a><a className="card resource-download" href={`${base}views/PlayerExport Stats.fmf`} download><strong>PlayerExport Stats</strong><span>Estatísticas de desempenho</span><b>Baixar .fmf</b></a></div></section>
}
