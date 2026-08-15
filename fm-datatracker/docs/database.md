# Banco de dados

A migration inicial cria profiles, saves, imports, players, player_snapshots, player_attributes, player_stats, role_models, scoring_models, player_scores, decisions e import_column_mappings. UUIDs são usados em todas as entidades. `unique(save_id,file_hash)` bloqueia import duplicado; `unique(player_id,import_id)` impede duas fotografias iguais no mesmo import.

O isolamento é aplicado pelo `owner_id` ou pela cadeia até `saves.owner_id`. RLS está habilitado em todas as tabelas. CA/PA, quando recebidos, ficam somente em JSON bruto e não têm coluna ou relação com scoring.
