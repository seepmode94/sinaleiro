# Sinaleiro

Um árbitro local para as sessões Claude Code abertas num computador, com uma quinta em pixel-art para as ver.

Quando duas sessões vão mexer no mesmo código, o Sinaleiro avisa-as ou trava-as até se decidir quem fica com o
ficheiro. A quinta mostra cada sessão como um Claude, os sub-agentes como mini-Claudes, os tokens gastos e o limite de
5 horas da conta. Também abre no telemóvel, no Wi-Fi de casa.

A quinta é a do [clodfarm](https://github.com/matank001/clodfarm), de Duke Security, Inc. (licença MIT). O
Sinaleiro reaproveita o motor visual, os sprites e o estilo desse projeto e acrescenta por cima o árbitro, o limite
de 5 horas e o acesso pelo telemóvel. Os detalhes estão em [Créditos](#créditos).

---

## Índice

- [Instalar e correr](#instalar-e-correr)
- [O árbitro: verde, amarelo, vermelho](#o-árbitro-verde-amarelo-vermelho)
- [A quinta](#a-quinta)
- [O limite de 5 horas e o ladrão](#o-limite-de-5-horas-e-o-ladrão)
- [No telemóvel](#no-telemóvel)
- [O chat (tmux)](#o-chat-tmux)
- [Segurança](#segurança)
- [Como funciona por dentro](#como-funciona-por-dentro)
- [Estrutura do repositório](#estrutura-do-repositório)
- [Testes](#testes)
- [Créditos](#créditos)

---

## Instalar e correr

Precisa de Python 3.10 ou mais recente e usa só a biblioteca padrão. O `qrencode` (para o QR code) e o `tmux` (para o
chat) são opcionais.

```bash
bin/sinaleiro install      # liga o Sinaleiro ao Claude Code (uma vez)
sinaleiro serve            # a quinta em http://localhost:7777
```

O `install` faz três coisas e não mexe em mais nada do `~/.claude/settings.json`:

1. acrescenta o hook `PreToolUse`, que corre antes de cada leitura ou edição de ficheiro;
2. põe a `sinaleiro statusline` na linha de estado. Se já tinhas uma statusline, ela continua a aparecer igual,
   porque o Sinaleiro corre-a por ti com o mesmo input;
3. cria o atalho `~/.local/bin/sinaleiro`.

**As sessões que já estavam abertas só apanham o hook e a statusline depois de reiniciadas.**

| Comando | O que faz |
|---|---|
| `sinaleiro serve` | a quinta, só neste computador (127.0.0.1) |
| `sinaleiro serve --lan` | também no Wi-Fi de casa, para o telemóvel (ver [No telemóvel](#no-telemóvel)) |
| `sinaleiro serve --lan --chat` | e com o chat que escreve nas sessões do tmux (ver [O chat](#o-chat-tmux)) |
| `sinaleiro status` | o mesmo que a quinta, no terminal: sessões, ficheiros, cruzamentos e limite |
| `sinaleiro grant <ficheiro> <sessão>` | passa um ficheiro que estás a editar para outra sessão |
| `sinaleiro release [ficheiro ...]` | larga os ficheiros (sem argumentos, larga todos) |
| `sinaleiro uninstall` | tira o hook e devolve a statusline que tinhas |

Outras opções do `serve`:
- `--port N` muda a porta;
- `--host IP` escolhe o endereço da rede de casa (só IPs privados);
- `--new-token` põe todos os telemóveis fora;
- `--show-convo` mostra as conversas também no telemóvel.

---

## O árbitro: verde, amarelo, vermelho

O hook pergunta ao árbitro antes de cada `Read`, `Edit`, `Write`, `MultiEdit` e `NotebookEdit`:

| Luz | Quando | O que acontece |
|---|---|---|
| 🟢 | nenhuma outra sessão por perto | nada |
| 🟡 | outra sessão viva leu ou editou o mesmo ficheiro, ou a mesma pasta, nos últimos 10 min | a chamada segue; o Claude recebe um aviso (uma vez por cruzamento) |
| 🔴 | outra sessão viva está a **editar o mesmo ficheiro** e não o passou | a edição é recusada; o Claude é mandado falar com a outra sessão |

- **Ler nunca é bloqueado.** O amarelo só acrescenta contexto e não mexe nas permissões.
- **Se o Sinaleiro falhar, por qualquer erro, a chamada segue.** O árbitro nunca deixa uma sessão encravada por
  culpa dele.
- **"Componente" é a pasta do ficheiro dentro do seu repositório.**

**Como se destrava um 🔴:**
- **Na quinta:** no botão DECISÕES, ou tocando no espantalho. As opções são **DAR A** quem pediu, **FICA COM** quem
  tem o ficheiro, ou **LIBERTAR** para todos.
- **Pelas próprias sessões:** `sinaleiro grant` ou `sinaleiro release`. As sessões podem combinar entre si por
  `SendMessage`.
- **Sozinho:** quando a sessão que tem o ficheiro fecha, ou quando passam 10 min sem lhe tocar (`SINALEIRO_TTL`,
  em segundos).

**Limites:**
- A sessão travada só fica a saber da decisão na próxima vez que tentar editar.
- Em `bypassPermissions`, a recusa do hook não conta.

---

## A quinta

A quinta mostra:

- **Claudes:** um por sessão aberta. A trabalhar, ocupa um talhão e escreve no portátil; em espera, passeia; ao fim
  de 5 min parada, dorme no pátio do celeiro.
- **Mini-Claudes:** os sub-agentes de cada sessão, na terra do talhão dela, incluindo os de background. Quando acabam,
  a cultura floresce.
- **O espantalho, que é o árbitro:** balança enquanto há sessões a trabalhar. Num cruzamento, levanta uma bandeira
  🟡 ou 🔴 e diz onde é. As sessões num 🔴 ficam com a bandeira vermelha e uma linha tracejada entre elas.
- **Cartas:** as mensagens `SendMessage` entre sessões voam de um Claude para o outro.
- **O topo:** os tokens de hoje e o relógio do limite de 5 horas.

**Tudo é clicável:**
- **um Claude:** abre o cartão com o pedido, a ferramenta, os tokens, os ficheiros (com LIBERTAR e PASSAR A), a
  conversa, a aparência e o comando para retomar;
- **um mini-Claude:** mostra o trabalho dele;
- **o espantalho:** abre as decisões;
- **o celeiro:** mostra os repositórios;
- **o lago e o ladrão:** abrem o limite de 5 horas.

A aparência de cada Claude fica guardada por pasta. A câmara arrasta e faz zoom.

**Teclas:** `+ − 0` câmara · `L` limite · `D` decisões · `R` sessões · `J` sub-agentes · `M` correio ·
`X` cruzamentos · `O` ocorrências · `N` nova sessão · `T` telemóvel · `C` chat · `?` ajuda.

---

## O limite de 5 horas e o ladrão

O Claude Code entrega à statusline a percentagem usada da conta: `rate_limits.five_hour` e `seven_day`. Essa
percentagem conta **tudo o que gastas na conta**: este computador, outros computadores e as apps Claude.

A `sinaleiro statusline` guarda essas leituras. Depois, o `sinaleiro/limits.py` compara cada subida da percentagem com
os tokens que este computador gastou, por modelo, lidos das transcrições:

> **fora deste PC = subida da % − tokens locais × quanto vale cada token**

**Quanto vale cada modelo** (Fable, Opus, Sonnet, Haiku) é aprendido sozinho, nos momentos em que um modelo fez quase
todo o trabalho local. Até aprender, o que corre aqui conta todo como "aqui".

**O relógio do topo** mostra a percentagem, a hora do reset, uma barra verde (aqui) e azul (fora) e, se for o caso,
"a este ritmo, limite às HH:MM". O cartão "O LIMITE" mostra:
- o ritmo por hora;
- os tokens por modelo nesta janela;
- quanto custa cada modelo: "100K tokens ≈ X % do limite";
- a semana.

O espantalho avisa aos 80 % e aos 95 %.

**O ladrão:** quando o consumo de fora sobe, aparece um Claude vermelho de gorro preto, que não trabalha no campo:
vai ao lago tirar tokens. Por cima mostra quanto veio de fora na última meia hora ("ladrão +6%"). Vai-se embora
depois de 20 min sem consumo de fora. É um só, porque o Sinaleiro não sabe quem é: só sabe que não foi este
computador.

**Limites:**
- A percentagem só se atualiza quando uma sessão **deste** computador recebe uma resposta. O consumo de fora só
  aparece na próxima resposta daqui.
- "Fora" é uma estimativa.

---

## No telemóvel

```bash
sinaleiro serve --lan
```

**Como entrar:**
1. O terminal mostra um link e um **QR code**. O QR também está na quinta do PC, no botão TELEMÓVEL.
2. No telemóvel, ligado ao mesmo Wi-Fi, lês o QR com a câmara e entras na quinta.
3. A partir daí, esse telemóvel fica com uma sessão própria durante **30 dias**.

**No telemóvel vês:** a quinta, as sessões, o pedido e a ferramenta de cada uma, os tokens e o limite. E podes tomar
as decisões do 🔴.

**O que fica só no PC:** as conversas (salvo `--show-convo`), o "+ NOVA SESSÃO" e o QR.

O Sinaleiro escuta nos IPs privados da máquina, com o Wi-Fi primeiro, e ignora as redes do Docker e das máquinas
virtuais.

---

## O chat (tmux)

```bash
sinaleiro serve --lan --chat
```

Um Claude aberto num terminal normal não pode ser comandado de fora. Dentro do **tmux**, sim: o Sinaleiro consegue ler
o ecrã dele e escrever-lhe. Com `--chat`, a quinta (no PC ou no telemóvel) passa a ter um chat que:

- **escreve um pedido** numa sessão, ou em todas de uma vez;
- **mostra o ecrã do terminal,** onde aparecem as perguntas de permissão;
- **responde às perguntas** com botões (`1`, `2`, `3`, `Enter`, `Esc`, setas, `Tab`), e só com essas teclas;
- **abre um Claude novo** num tmux à parte: em "+ NOVA SESSÃO" (ou "+ CLAUDE" no chat) navegas pelas pastas a partir
  de `~/Documentos` e escolhes "ABRIR CLAUDE AQUI". No PC abre também uma janela de terminal ligada a esse tmux
  (xfce4-terminal, gnome-terminal ou konsole); do telemóvel, nunca.

Para uma sessão aparecer no chat, tem de ser aberta dentro do tmux, por exemplo `tmux new -s nome claude`, ou pelo
botão "+ NOVA SESSÃO" da quinta.

> ⚠️ **Com `--chat`, quem entra na quinta pode escrever nos teus terminais**, ou seja, executar comandos no PC.
> Usa-o só no teu Wi-Fi e com o telemóvel bloqueado.

---

## Segurança

- **Sem `--lan`, a quinta só responde no próprio computador.**
- **Entrada pelo telemóvel:**
  - o link do QR leva um token que serve **uma vez** e só durante **15 minutos**, e sai do endereço logo à entrada;
  - a página troca-o por uma sessão do telemóvel, num cookie `HttpOnly` e `SameSite=Strict`;
  - o PC guarda só uma impressão (hash) dessa sessão, não a sessão em si;
  - há um limite de tentativas falhadas por minuto.
- **Proteções contra outros sites:**
  - as ações exigem o cabeçalho `X-Sinaleiro` e uma `Origin` igual ao `Host`, para outra página não as poder fazer;
  - um `Host` que não seja um dos endereços da máquina é recusado, o que trava o DNS rebinding.
- **Conversas:** ficam no PC, salvo `--show-convo` ou `--chat`.
- **É HTTP simples:** usa-o só numa rede de confiança e **sem túneis nem proxies à frente**. Um pedido que chega de
  `127.0.0.1` conta como o próprio PC.
- **O link do QR é como uma password.** Se o perderes, corre `sinaleiro serve --lan --new-token` e todos os
  telemóveis ficam fora.

---

## Como funciona por dentro

| De onde | O quê |
|---|---|
| `~/.claude/sessions/<pid>.json` | as sessões vivas (nome, pasta, a trabalhar ou parada), mantidas pelo Claude Code |
| `~/.claude/projects/*/<sessão>.jsonl` | as transcrições: último pedido, ferramenta, sub-agentes, mensagens, tokens por modelo |
| `~/.claude/projects/*/<sessão>/subagents/*.jsonl` | as transcrições dos sub-agentes (gastam o mesmo limite) |
| statusline do Claude Code | a percentagem do limite de 5 horas e da semana |
| `~/.claude/sinaleiro/state.db` | o estado do Sinaleiro (SQLite, WAL): toques em ficheiros, passagens, decisões, aparências, leituras do limite e sessões dos telemóveis |

- **Os tokens** são os de entrada, saída e escrita em cache; as leituras de cache não contam. Cada resposta conta uma
  só vez, com o valor final.
- **As transcrições** são lidas aos bocados: cada ficheiro é lido uma vez, e depois só o que lhe foi acrescentado.

---

## Estrutura do repositório

```
bin/sinaleiro            o comando
sinaleiro/
  arbiter.py             as regras do árbitro (funções puras)
  cli.py                 o hook, os comandos, a statusline, o estado da quinta e o instalador
  limits.py              o limite de 5 horas: aqui e fora, ritmo, quanto vale cada modelo (funções puras)
  server.py              a quinta e a API; o acesso pelo telemóvel
  sessions.py            as sessões vivas
  store.py               a base de dados SQLite
  transcripts.py         a leitura das transcrições
  tmux.py                o chat: ler e escrever nas sessões do tmux
ui/
  index.html, app.js     a quinta do Sinaleiro (cartões, decisões, limite, chat)
  ladrao.js              o ladrão do lago
  login.html, login.js   a entrada do telemóvel
  sinaleiro.css          o estilo do Sinaleiro
  vendor/                o código do clodfarm (ver Créditos)
  fonts/                 Press Start 2P e VT323 (OFL)
tests/                   pytest
```

---

## Testes

```bash
python -m pytest tests
```

Os testes cobrem:
- o árbitro;
- as contas do limite;
- a leitura das transcrições;
- a instalação, sem tocar no `settings.json` verdadeiro;
- a segurança do acesso pelo telemóvel;
- o chat.

Usam bases de dados temporárias e nunca o teu `~/.claude`.

---

## Créditos

**O [clodfarm](https://github.com/matank001/clodfarm)**, de Duke Security, Inc. (licença MIT), é o projeto original
da quinta: uma quinta em pixel-art onde agentes Claude trabalham. O Sinaleiro nasceu da análise desse repositório e
usa uma cópia de partes do código dele, a partir do commit `10305ea`:

| Ficheiro | De onde vem no clodfarm |
|---|---|
| `ui/vendor/engine.js` | `ui/app.js`, linhas 1-1604: sprites, mundo, Claudes e cena |
| `ui/vendor/picker.js` | `ui/app.js`, linhas 3069-3177: o seletor de aparência |
| `ui/vendor/clodfarm.css` | `ui/style.css` |

- **O aviso da licença MIT** vai no topo de `ui/vendor/engine.js` e aplica-se aos três ficheiros.
- **As alterações feitas pelo Sinaleiro** estão marcadas com `sinaleiro:` no código.
- **O que é próprio do Sinaleiro:** o árbitro, a leitura das sessões e das transcrições locais, o espantalho como
  árbitro, o limite de 5 horas e o ladrão, o acesso pelo telemóvel e o chat.

**As fontes:** [Press Start 2P](https://fonts.google.com/specimen/Press+Start+2P) e
[VT323](https://fonts.google.com/specimen/VT323), ambas com licença SIL Open Font License (OFL). Os textos das
licenças estão em `ui/fonts/`.
