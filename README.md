# Sinaleiro

Um sinaleiro para as sessões Claude Code abertas nesta máquina. Vê o que cada sessão está a fazer e, quando duas
se aproximam do mesmo código, avisa-as ou trava-as até combinarem entre si (por `SendMessage`). Tudo aparece
numa quinta em pixel-art: cada repo é um talhão, cada sessão é um boneco.

## Semáforo

| Luz | Quando | O que acontece |
|---|---|---|
| 🟢 | ninguém mais por perto | nada |
| 🟡 | outra sessão viva leu ou editou o mesmo ficheiro, ou a mesma pasta, nos últimos 10 min | a chamada segue; o Claude recebe um aviso (uma vez por cruzamento) |
| 🔴 | outra sessão viva está a **editar o mesmo ficheiro** e não o passou | a edição é recusada; o Claude é mandado falar com a outra sessão |

Leituras nunca são bloqueadas. O amarelo não mexe nas permissões (só acrescenta contexto), e qualquer erro do
sinaleiro deixa a chamada seguir.

Para desbloquear, a sessão que tem o ficheiro corre:

```bash
sinaleiro grant <ficheiro> <nome-da-sessão>   # passa-o a outra sessão (ou decide na quinta, em DECISÕES)
sinaleiro release [ficheiro ...]              # terminei (sem argumentos: tudo o que tenho)
```

Se a sessão morrer, ou passarem 10 min sem tocar no ficheiro (`SINALEIRO_TTL`, em segundos), o bloqueio cai sozinho.

## Usar

```bash
bin/sinaleiro install     # acrescenta o hook PreToolUse e a statusline em ~/.claude/settings.json, e ~/.local/bin/sinaleiro
sinaleiro serve           # a quinta em http://localhost:7777 (só 127.0.0.1)
sinaleiro serve --lan     # ...e também no Wi-Fi de casa, para o telemóvel: mostra um QR code com o link (token)
sinaleiro status          # o mesmo no terminal
sinaleiro uninstall       # tira o hook e devolve a tua statusline
```

As sessões já abertas só apanham o hook e a statusline depois de reiniciadas.

## Como funciona

- `~/.claude/sessions/<pid>.json`: o registo das sessões vivas (nome, cwd, busy/idle), que o Claude Code mantém.
- `~/.claude/projects/*/<sessão>.jsonl`: a transcrição de cada sessão, de onde vêm o último pedido e a ferramenta atual.
- O hook (`Read|Edit|Write|MultiEdit|NotebookEdit`) regista cada toque em `~/.claude/sinaleiro/state.db`
  (SQLite, WAL) e pede a decisão a `sinaleiro/arbiter.py`, que só tem funções puras e testadas.
- "Componente" = a pasta do ficheiro dentro do seu repo.
- **O limite de 5 horas:** o Claude Code entrega à statusline a % usada da conta (`rate_limits.five_hour`). A
  `sinaleiro statusline` guarda essas leituras e mostra a tua statusline anterior, se tinhas uma (guardada em
  `~/.claude/sinaleiro/statusline.json`), com o mesmo input. `sinaleiro/limits.py` compara cada subida da % com os tokens
  locais por modelo e aprende quanto vale cada um; o que os tokens daqui não explicam é "fora" (outro PC, apps).
  A % só se atualiza quando uma sessão deste PC recebe uma resposta.

- **No telemóvel (`serve --lan`):** escuta também nos IPs privados desta máquina (Wi-Fi primeiro; sem Docker/VMs).
  O QR code (no terminal, ou na quinta do PC: TELEMÓVEL) abre `/#t=<token>`. O token serve **uma vez** e durante
  15 min; a página troca-o por uma sessão própria desse telemóvel (cookie HttpOnly, SameSite=Strict, 30 dias). O PC só
  guarda o hash de cada sessão. `--new-token` põe todos os telemóveis fora. As conversas ficam no PC (`--show-convo`
  mostra-as também). É HTTP simples: só numa rede de confiança, e **sem túneis nem proxies à frente** (um pedido que
  chega de 127.0.0.1 conta como o próprio PC).
- **O ladrão:** quando a % da conta sobe mais do que os tokens deste PC explicam (outro computador, as apps), aparece
  um Claude vermelho de gorro preto que vai ao lago tirar tokens. Fica enquanto houve consumo de fora nos últimos
  20 min. Tocar nele (ou no lago) abre o limite.

Só biblioteca padrão do Python (3.10+); o QR code usa o `qrencode`, se existir. Testes: `python -m pytest tests`.

## A quinta

`sinaleiro serve` abre a quinta do [clodfarm](https://github.com/matank001/clodfarm), alimentada pelas sessões locais:

- **Claudes:** cada sessão aberta. A trabalhar ocupa um talhão e escreve no portátil, em espera passeia, e ao fim
  de 5 min parada dorme no pátio do celeiro.
- **Mini-Claudes:** os sub-agentes (Agent/Task) de cada sessão, à volta do talhão dela, incluindo os de background.
  Quando acabam, a cultura floresce.
- **O espantalho é o árbitro:** o do original, no canto do campo. Balança enquanto há sessões a trabalhar e dorme
  quando estão todas paradas. Num cruzamento, levanta uma bandeira 🟡/🔴 e diz onde é. As sessões envolvidas num 🔴
  ficam com a bandeira vermelha e uma linha tracejada entre elas.
- **Decisões:** quando o espantalho trava uma edição, aparece "⚑ N DECISÕES PARA TOMAR" no topo e o botão DECISÕES
  da dock pisca. Escolhes **DAR A** quem pediu (passa na próxima tentativa), **FICA COM** quem tem o ficheiro (quem
  pediu é avisado para fazer outra coisa, sem voltar a perguntar-te) ou **LIBERTAR** para todos.
- **Cartas:** as mensagens `SendMessage` entre sessões voam de um Claude para o outro.
- **Tokens:** o contador mostra os tokens de hoje em toda a quinta, lidos das transcrições.

Tudo é clicável:
- **um Claude:** cartão com pedido, ferramenta atual, tokens, mini-Claudes, ficheiros (com LIBERTAR / PASSAR A),
  conversa, aparência e o comando para retomar;
- **um mini-Claude:** o seu trabalho;
- **o espantalho:** as decisões (ou os cruzamentos, se não houver nada para decidir);
- **o celeiro:** os repositórios;
- **a dock:** sessões, mini-Claudes, correio, cruzamentos, ocorrências, nova sessão e ajuda.

A aparência fica guardada por pasta. A câmara arrasta e faz zoom. Teclas: `+ − 0 D R J M X O N ?`.

`ui/vendor/` tem o código do clodfarm (MIT, aviso em `ui/vendor/engine.js`; alterações marcadas `sinaleiro:`):
`engine.js` (sprites, mundo, cena), `picker.js` (seletor de aparência) e `clodfarm.css`. As fontes estão em
`ui/fonts/` (OFL).
