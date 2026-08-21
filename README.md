# PMF Cut

Editor de vídeo por conversa, da PMF Produtora. Você aponta a pasta do material,
descreve o que quer em português, e o corte acontece em fases — com um painel de
preview onde você aprova, marca correções e escolhe o estilo.

Vertical (Reels/TikTok/Shorts) e horizontal (YouTube).

## Como funciona

**Fase 1 — o corte.** Transcreve, escolhe os melhores takes, corta no silêncio,
detecta o perfil de cor da câmera e aplica a correção certa. Sai um `cut.mp4`
limpo. Nada de texto ou gráfico ainda — só a edição.

**O portão.** Você vê o corte e aprova. Nada da Fase 2 começa antes disso.

**Fase 2 — o visual.** Legendas, headline de gancho, câmera dinâmica, tela
dividida, B-roll, transições. Tudo descrito em UM arquivo JSON: o template
Remotion é imutável, a edição é dado.

**Fase 3 — a trilha.** Gerada por IA ou um arquivo seu, mixada e normalizada.

## Painel de preview

Timeline de editor real — filmstrip, forma de onda, playhead, alças de trim.
É por ali que você aprova o corte, marca um trecho e escreve o que mudar, e
escolhe o estilo da Fase 2 vendo cada opção renderizada de verdade.

## Instalação

### O que precisa estar na máquina

| | Para quê | Como instalar |
|---|---|---|
| **ffmpeg** | Fases 1 e 3 (corte, cor, áudio) | `brew install ffmpeg` · `apt install ffmpeg` |
| **Python 3.10+** com [uv](https://docs.astral.sh/uv/) | os helpers | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| **Node 18+** | Fase 2 (Remotion) | `brew install node` ou [nvm](https://github.com/nvm-sh/nvm) |
| **yt-dlp** *(opcional)* | editar a partir de um link | `brew install yt-dlp` |

### Passo a passo

```bash
git clone https://github.com/pmfproducer/pmf-cut.git ~/Developer/pmf-cut
cd ~/Developer/pmf-cut
uv sync                                   # dependências Python
cp .env.example .env                      # e preencha a chave (tabela abaixo)

# registrar como skill do agente (Claude Code)
mkdir -p ~/.claude/skills
ln -sfn ~/Developer/pmf-cut ~/.claude/skills/pmf-cut

# Fase 2 — a skill do Remotion
git clone --depth 1 https://github.com/remotion-dev/skills ~/Developer/remotion-skills
ln -sfn ~/Developer/remotion-skills/skills/remotion ~/.claude/skills/remotion
```

Depois é só entrar na pasta do material, abrir o agente ali e dizer o que quer:
*"edite isso num reel"*. Tudo sai em `<pasta>/edit/` — o repo fica limpo.

Symlink a pasta **inteira**, não só o `SKILL.md`: os helpers precisam ficar ao lado.
Passo a passo completo, com Linux e outros agentes, em [install.md](install.md).

### Chaves de API

Todas vão no `.env` na raiz do repo, que **nunca é commitado** — cada pessoa cria
as suas. Só a Groq é obrigatória; o agente pede as outras sozinho na primeira vez
que precisar de cada uma.

| Chave | Para quê | Criar em |
|---|---|---|
| `GROQ_API_KEY` **(obrigatória)** | transcrição | https://console.groq.com/keys |
| `ELEVENLABS_API_KEY` | fontes > 5 min, e voz | https://elevenlabs.io/app/settings/api-keys |
| `PEXELS_API_KEY` | imagens/vídeos de apoio | https://www.pexels.com/api/ |
| `TREBLO_API_KEY` | trilha por IA | https://sonauto.ai |
| `GOOGLE_API_KEY` + `GOOGLE_CSE_ID` | imagens de marcas e pessoas | [credenciais](https://console.cloud.google.com/apis/credentials) · [CSE](https://programmablesearchengine.google.com/controlpanel/all) |

O plano gratuito da Groq dá conta com folga. As imagens também funcionam **sem
chave nenhuma** via Wikimedia Commons, então a Fase 2 nunca fica travada.

## Estrutura

```
SKILL.md            o método — as regras que o agente segue
references/         short-form, longform, Premiere via MCP
helpers/            ffmpeg, transcrição, verificação, preview
assets/shortform/   template Remotion vertical (data-driven)
assets/longform/    template Remotion horizontal
assets/preview/     o painel de preview (imutável, compartilhado)
```

## Licença

MIT. Trabalho derivado do projeto MIT da Creator Factory; o aviso de copyright
original permanece no [LICENSE](LICENSE), como a licença exige.
