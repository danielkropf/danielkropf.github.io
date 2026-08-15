# Arquitetura

O app é isolado do site estático existente e compilado com base `/fm-datatracker/`. `HashRouter` garante navegação estática. Componentes cuidam de interação; `src/lib` contém regras puras e testáveis. O cliente usa somente a chave pública Supabase e todas as tabelas são protegidas por RLS.

Fluxo-alvo: arquivo local → parser/normalização → preview obrigatório → hash/duplicidade → identidade do jogador → import + snapshots em transação → scoring versionado → relatório. Nenhum snapshot anterior é atualizado durante um import.
