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

Veja [install.md](install.md). Resumo: clonar, `uv sync`, `ffmpeg` no PATH,
Node 18+ para a Fase 2, e um symlink em `~/.claude/skills/pmf-cut`.

Chaves (todas em `.env`, nunca commitadas): `GROQ_API_KEY` (transcrição),
`ELEVENLABS_API_KEY` (fontes longas), `PEXELS_API_KEY` (B-roll),
`TREBLO_API_KEY` (trilha por IA), `GOOGLE_API_KEY` + `GOOGLE_CSE_ID` (imagens).

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
