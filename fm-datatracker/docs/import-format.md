# Importação: CSV e save `.fm`

## Modos aceitos

| Arquivos enviados | Uso | Limites |
| --- | --- | --- |
| CSV | Caminho estável para atributos, dados exportados e snapshots. | Dados internos e informações que o export não contém permanecem indisponíveis. |
| `.fm` | Leitura local beta do save. | Pode conter campos vazios ou mapeamentos ainda não confirmados. |
| CSV + `.fm` | Caminho recomendado. A aplicação compara as fontes antes de combinar dados. | Divergências e campos não comparáveis precisam permanecer auditáveis. |

Os arquivos são lidos no navegador. CSV usa Papa Parse em worker; `.fm` usa `fm26-offline-worker.ts`. Enquanto uma leitura está em andamento, a confirmação fica desabilitada, mas a navegação do aplicativo não deve ser bloqueada.

## Datas

- Toda importação exige uma data completa `AAAA-MM-DD` válida antes da confirmação.
- CSV sem `.fm`: idade + nascimento podem sugerir apenas o **ano**. A interface mostra essa sugestão, mas não inventa `01/01`; o usuário informa/confirma a data completa.
- Com `.fm`: uma data com precisão `day` controla o snapshot e pode bloquear o campo. Se o leitor confirmar apenas `year`, o ano aparece como evidência, o campo permanece editável e o usuário precisa informar dia/mês no mesmo ano. Uma âncora `YYYY-01-01` interna jamais pode ser persistida como se fosse a data real.

## Validação CSV × `.fm`

Jogadores são associados por `Unique ID` sempre que ele existir. Sem ID no CSV, o fallback seguro é nome normalizado + data de nascimento; nome isolado só é aceito quando é único nas duas fontes. A mesma linha do `.fm` nunca pode validar dois jogadores. A validação compara apenas dados com interpretação confirmada. Comparações semânticas normalizam:

- datas `d/m/yyyy` e `yyyy-mm-dd`;
- pé preferido;
- notação completa de posição, preservando `L`, `C` e `R`;
- rótulos de atributos como `Team Work`, `Punching` e `Rushing Out (Tendency)`.

Uma leitura combinada só habilita recursos dependentes do save quando a cobertura de jogadores e de dados comparáveis atingir o limiar definido no painel. Caso contrário, o import segue como fallback CSV e deixa o motivo visível.

Campos sem mapeamento confirmado não são tratados como divergência: aparecem como **não comparáveis**. Divergências devem mostrar jogador, campo, valor CSV e valor `.fm`; não reduza o diagnóstico a um percentual geral.

Para habilitar o modo combinado, todos os jogadores do CSV precisam ser associados sem ambiguidade e os campos efetivamente comparados não podem divergir. O CSV define quais linhas serão persistidas; jogadores extras encontrados no `.fm` ficam fora daquele import em vez de serem acrescentados silenciosamente.

## Dados `.fm`: contrato atual

Confirmados no leitor offline v0.22 incluem identidade de alta confiança, data de nascimento, nacionalidade, altura, posições jogáveis por nível de habilidade, **força individual de cada pé**, pé preferido derivado, atributos 1–20 e dados brutos auditáveis. Alguns dados ocultos são preservados com procedência; os oito componentes pessoais descritos abaixo já têm posição/escala confirmadas, enquanto rótulos derivados continuam separados até validação específica.

O `Team ID` usado nos grupos estruturais do save é um ordinal 1-based da tabela de squads (`team_index_zero_based + 1`), não o Unique ID público do clube. Em linhas padrão, a entrada da equipe contém uma chave repetida que reaparece no registro textual correspondente em `game_db.dat`; quando essa cadeia é única e válida, o leitor pode resolver o nome da equipe diretamente do próprio save. Exemplos revalidados: `449 → Chelsea`, `679 → FC Bayern München`, `1993 → FC Bayern München II`, `1233 → Tenerife`, `5354 → Tenerife B` e `16826 → Tenerife C`. Estruturas variantes, especialmente alguns grupos jovens, devem permanecer sem nome quando essa cadeia não puder ser provada.

O shape histórico `[person EID][team ID][00000000]` continua sendo evidência de uma relação organizacional/contratual, mas **não deve ser rotulado isoladamente como clube proprietário**. Jogadores podem materializar mais de um vínculo e o elenco atual é uma dimensão separada. Até que a classificação de vínculo permanente/empréstimo seja comprovada, preserve o Team ID e seu nome resolvido como evidência, sem inferir ownership.

Ainda não há mapeamento offline confirmado para **clube proprietário**, valor de transferência, fim de contrato completo, classificação de empréstimo, cláusulas normalizadas, histórico internacional/base, reputação mundial textual, felicidade/moral e **rótulo textual final de personalidade**. O nome de uma equipe referenciada por Team ID pode ser resolvido independentemente dessa semântica. Esses campos podem estar no CSV e devem ficar marcados como fonte única até confirmação.

### Pés individuais

O bloco de ability guarda `Left Foot` e `Right Foot` **separadamente**, na mesma sequência de 54 atributos já mapeada pelo leitor. Cada lado é preservado em duas formas:

- `left_raw` / `right_raw`: byte interno `1..100`;
- `left` / `right`: escala `1..20`, com a conversão já usada e validada pelo reader: `floor(raw / 5 + 0.5)`, limitada a `1..20`.

Portanto, a antiga descrição de que a “escala individual de pé” ainda precisava ser descoberta está obsoleta: **a força numérica de cada pé já está decodificada**. O pé preferido é outro dado, derivado da comparação entre os dois lados (`Left`, `Right` ou `Either` em empate), e não substitui os dois ratings individuais.

Para apresentação textual, usar a seguinte semântica de força na escala `1..20`:

| Rating | Texto |
| --- | --- |
| 1–4 | Very Weak |
| 5–7 | Weak |
| 8–11 | Reasonable |
| 12–14 | Fairly Strong |
| 15–17 | Strong |
| 18–20 | Very Strong |

A aplicação deve continuar preservando o valor numérico/raw mesmo quando mostrar o texto, para evitar perda de precisão e permitir revalidação futura.

### Personalidade

O `.fm` já fornece **oito componentes pessoais ocultos**, todos em `1..20`, na sequência confirmada do prefixo de pessoa:

`Adaptability`, `Ambition`, `Loyalty`, `Pressure`, `Professionalism`, `Sportsmanship`, `Temperament`, `Controversy`.

`Determination` e `Leadership` também estão disponíveis separadamente no bloco de atributos. Referências atuais de FM26 descrevem o rótulo de personalidade exibido pelo jogo como dependente de `Determination`/`Leadership` e de seis desses componentes ocultos (`Ambition`, `Loyalty`, `Pressure`, `Professionalism`, `Sportsmanship`, `Temperament`). `Adaptability` e `Controversy` continuam preservados como dados pessoais ocultos, mas não devem ser incluídos automaticamente na fórmula do rótulo apenas por estarem adjacentes no save.

O estado correto do mapping é, portanto:

- **confirmado offline:** os oito componentes ocultos e seus valores `1..20`;
- **confirmado runtime:** o Oracle consegue ler a propriedade `Personality` usada como rótulo da UI;
- **candidato derivado:** reconstruir offline esse rótulo a partir dos componentes + atributos visíveis;
- **ainda não confirmado:** a tabela completa de limiares, precedência quando mais de um rótulo é elegível, exceções por idade/newgen/clube favorito e eventual existência de um enum/string textual persistido separadamente no `.fm`.

Até uma bateria controlada comparar componentes offline com o texto efetivamente exibido pelo FM26, **não preencher `Personality` por aproximação**. Preserve os componentes; o rótulo deve continuar nulo/desconhecido quando não houver ground truth.

`Current Ability` e `Potential Ability` extraídos pelo leitor offline são **candidatos com procedência**, não uma solução validada de CA/PA. Não os use em scoring nem os apresente como CA/PA confirmados sem reproduzir âncoras conhecidas do Oracle.

## Privacidade e amostras

Após falha de validação, o usuário pode autorizar explicitamente o envio privado dos dois arquivos para `fm-reader-samples`. Sem consentimento, arquivos nunca saem do navegador além dos dados normalizados usados no import. Nunca adicione saves, DLLs, dumps ou amostras privadas ao repositório público.

## Dados persistidos

Cada linha importada mantém `raw_data` separado de `normalized_data`. O primeiro preserva evidência por fonte; o segundo é o contrato consumido pelas telas. Não descarte dados crus ao introduzir um novo mapeamento, pois eles são necessários para auditoria e regressão.
