"""Voz da Fase 0: divide o roteiro em blocos e fala cada um pelo OmniVoice.

Blocos existem para que refazer UMA frase não custe refazer o roteiro inteiro.
O worker fica vivo entre os pedidos porque carregar o modelo custa ~10 s.
"""
from __future__ import annotations

import array
import json
import os
import re
import subprocess
import threading
import wave
from pathlib import Path

import requests

# Onde o OmniVoice foi instalado (install.md, passo da Fase 0). OMNIVOICE_DIR no
# .env muda o local; o padrão é o do instalador.
OMNIVOICE_DIR = Path(os.environ.get("OMNIVOICE_DIR")
                     or Path.home() / "Developer" / "OmniVoice").expanduser()
OMNIVOICE_PY = OMNIVOICE_DIR / ".venv" / "bin" / "python"
VOZES = OMNIVOICE_DIR / "vozes"
VOZ_PREFERIDA = os.environ.get("PMF_VOZ", "pablo")
SR = 24000
PAUSA_S = 0.22          # respiro entre blocos, medido como natural no teste de 50 s
LIMITE_BLOCO = 180      # caracteres: junta frases curtas, separa as longas

_proc: subprocess.Popen | None = None
_trava = threading.Lock()


def dividir(texto: str) -> list[str]:
    """Quebra em blocos de fala, agrupando frases curtas até `LIMITE_BLOCO`.

    Só `.`, `!` e `?` fecham frase. Dois-pontos ANUNCIAM continuação: quebrar ali
    fazia "Terceiro, agenda: dia, hora…" virar dois blocos, cada um sintetizado
    sozinho — a voz fechava "agenda" com entonação de fim de frase e o `juntar`
    ainda enfiava um respiro antes de "dia".
    """
    frases = [s.strip() for s in re.split(r"(?<=[.!?])\s+", texto.strip()) if s.strip()]
    blocos: list[str] = []
    atual = ""
    for f in frases:
        if atual and len(atual) + len(f) + 1 > LIMITE_BLOCO:
            blocos.append(atual)
            atual = f
        else:
            atual = f"{atual} {f}".strip()
    if atual:
        blocos.append(atual)
    return blocos


def _worker() -> subprocess.Popen:
    global _proc
    if _proc and _proc.poll() is None:
        return _proc
    if not OMNIVOICE_PY.exists():
        raise RuntimeError(f"OmniVoice não encontrado em {OMNIVOICE_DIR}")
    # O script é nosso, mas roda no venv do OmniVoice — é lá que o pacote vive.
    _proc = subprocess.Popen(
        [str(OMNIVOICE_PY), str(Path(__file__).resolve().parent / "omnivoice_worker.py")],
        cwd=OMNIVOICE_DIR, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        text=True, bufsize=1,
    )
    for linha in _proc.stdout:                    # espera o sinal de pronto
        if linha.strip() and json.loads(linha).get("pronto"):
            break
    return _proc


def _pedir(pedido: dict) -> dict:
    with _trava:                                   # o worker atende um por vez
        p = _worker()
        p.stdin.write(json.dumps(pedido) + "\n")
        p.stdin.flush()
        resp = json.loads(p.stdout.readline())
    if not resp.get("ok"):
        raise RuntimeError(resp.get("erro", "o worker falhou"))
    return resp


def catalogo() -> dict:
    """Vozes disponíveis, do arquivo de metadados da pasta de vozes."""
    f = VOZES / "vozes.json"
    return json.loads(f.read_text(encoding="utf-8")) if f.exists() else {}


def padrao() -> str | None:
    """A voz preferida se existir; senão a primeira do catálogo; senão None.

    Numa instalação nova o catálogo começa vazio — a voz de ninguém vem pronta.
    """
    vozes = catalogo()
    if VOZ_PREFERIDA in vozes:
        return VOZ_PREFERIDA
    return next(iter(vozes), None)


def falar(texto: str, destino: Path, passos: int = 32, voz: str | None = None) -> float:
    """Sintetiza um bloco com a voz escolhida. Devolve a duração em segundos."""
    vozes = catalogo()
    voz = voz or padrao()
    if not vozes:
        raise RuntimeError("nenhuma voz clonada ainda: na aba Voz, use 'clonar outra' "
                           "com um trecho CRU de câmera/microfone")
    if voz not in vozes:
        raise RuntimeError(f"voz desconhecida: {voz}")
    destino.parent.mkdir(parents=True, exist_ok=True)
    resp = _pedir({
        "op": "falar",
        "voz": str((VOZES / vozes[voz]["prompt"]).resolve()),
        "texto": texto, "saida": str(destino.resolve()), "passos": passos,
    })
    return resp["dur"]


def extrair_trecho(origem: Path, inicio: float, duracao: float, destino: Path) -> Path:
    """Tira um trecho limpo de qualquer vídeo/áudio para servir de referência."""
    destino.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run([
        "ffmpeg", "-y", "-hide_banner", "-v", "error",
        "-ss", str(inicio), "-t", str(duracao), "-i", str(origem),
        "-vn", "-ac", "1", "-ar", "24000", str(destino),
    ], check=True)
    return destino


def transcrever(audio: Path) -> str:
    """Transcreve a referência pelo Groq — mesma convecão do helpers/transcribe.py."""
    chave = os.environ.get("GROQ_API_KEY")
    if not chave:
        raise RuntimeError("GROQ_API_KEY ausente: escreva a transcrição na mão")
    with open(audio, "rb") as f:
        r = requests.post(
            "https://api.groq.com/openai/v1/audio/transcriptions",
            headers={"Authorization": f"Bearer {chave}"},
            files={"file": (audio.name, f, "audio/wav")},
            data={"model": "whisper-large-v3", "language": "pt",
                  "response_format": "json"},
            timeout=120,
        )
    r.raise_for_status()
    return (r.json().get("text") or "").strip()


def clonar(ref_audio: Path, ref_texto: str, chave: str, nome: str) -> dict:
    """Cria uma voz nova a partir de um áudio de referência e o registra.

    A referência precisa ser take CRU de câmera/microfone: áudio já masterizado
    faz o clone copiar a compressão e a EQ junto com o timbre.
    """
    VOZES.mkdir(parents=True, exist_ok=True)
    destino_ref = VOZES / f"{chave}.wav"
    if ref_audio.resolve() != destino_ref.resolve():
        destino_ref.write_bytes(ref_audio.read_bytes())
    _pedir({
        "op": "clonar", "ref": str(destino_ref.resolve()),
        "texto": ref_texto, "saida": str((VOZES / f"{chave}.pt").resolve()),
    })
    vozes = catalogo()
    vozes[chave] = {"nome": nome, "prompt": f"{chave}.pt",
                    "referencia": f"{chave}.wav", "texto": ref_texto,
                    "origem": "criada no app"}
    (VOZES / "vozes.json").write_text(
        json.dumps(vozes, ensure_ascii=False, indent=1), encoding="utf-8")
    return vozes[chave]


def picos(arquivo: Path, n: int = 130) -> list[float]:
    """Envelope do bloco, normalizado em 0..1, para desenhar a forma de onda.

    Calculado uma vez na geração e guardado no bloco: a UI só desenha.
    """
    with wave.open(str(arquivo), "rb") as w:
        amostras = array.array("h")
        amostras.frombytes(w.readframes(w.getnframes()))
    if not amostras:
        return [0.0] * n
    passo = max(1, len(amostras) // n)
    brutos = []
    for i in range(n):
        janela = amostras[i * passo:(i + 1) * passo] or array.array("h", [0])
        brutos.append(max(abs(min(janela)), abs(max(janela))))
    topo = max(brutos) or 1
    return [round(v / topo, 3) for v in brutos]


def juntar(arquivos: list[Path], destino: Path) -> float:
    """Concatena os blocos com um respiro entre eles. Devolve a duração total."""
    silencio = b"\x00\x00" * int(PAUSA_S * SR)
    with wave.open(str(destino), "wb") as saida:
        saida.setnchannels(1)
        saida.setsampwidth(2)
        saida.setframerate(SR)
        for i, a in enumerate(arquivos):
            with wave.open(str(a), "rb") as e:
                saida.writeframes(e.readframes(e.getnframes()))
            if i < len(arquivos) - 1:
                saida.writeframes(silencio)
    with wave.open(str(destino), "rb") as f:
        return f.getnframes() / f.getframerate()


def encerrar() -> None:
    global _proc
    if _proc and _proc.poll() is None:
        _proc.terminate()
    _proc = None
