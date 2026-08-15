const builtAt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(__BUILD_TIME__))

export function AppVersion() {
  return <div className="app-version" title={`Build publicado em ${builtAt} · commit ${__BUILD_ID__}`}><span>v{__APP_VERSION__}</span><span>{__BUILD_ID__}</span><time dateTime={__BUILD_TIME__}>{builtAt}</time></div>
}
