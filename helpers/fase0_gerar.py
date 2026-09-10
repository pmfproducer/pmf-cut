#!/usr/bin/env python
"""Fase 0 do PMF Cut: roteiro -> voz (OmniVoice local) -> avatar (HeyGen v3) -> MP4.

Entrega um vídeo bruto pronto para entrar na Fase 1 (corte e cor).

Uso:
    uv run helpers/fase0_gerar.py --roteiro roteiro.txt --avatar <look_id> --out projeto/
    uv run helpers/fase0_gerar.py --roteiro roteiro.txt --so-voz          # nao gasta credito
    uv run helpers/fase0_gerar.py --listar-avatares
"""
import argparse, json, os, subprocess, sys, time, urllib.parse, urllib.request
from pathlib import Path

API = "https://api.heygen.com/v3"


class Fase0Erro(RuntimeError):
    """Falha esperada da Fase 0 (chave ausente, HeyGen recusou, tempo esgotado).

    Estas funções rodam também dentro do servidor. `sys.exit` numa thread levanta
    SystemExit, que escapa do `except Exception`: um render PAGO que falhava no
    HeyGen deixava a tela em "renderizando" para sempre, e sem a chave o
    /api/estado derrubava a conexão. Só o `main()` converte isto em saída.
    """


def _key() -> str:
    k = os.environ.get("HEYGEN_API_KEY")
    if not k:
        raise Fase0Erro("HEYGEN_API_KEY ausente. Carregue o .env antes de rodar.")
    return k


def _req(metodo: str, caminho: str, corpo=None, binario=None, content_type=None):
    url = caminho if caminho.startswith("http") else f"{API}{caminho}"
    cabecalhos = {"X-Api-Key": _key()}
    dados = None
    if corpo is not None:
        dados = json.dumps(corpo).encode()
        cabecalhos["Content-Type"] = "application/json"
    elif binario is not None:
        dados = binario
        cabecalhos["Content-Type"] = content_type
    r = urllib.request.Request(url, data=dados, headers=cabecalhos, method=metodo)
    with urllib.request.urlopen(r) as resp:
        return json.loads(resp.read())


def listar_avatares(filtro: str = "") -> list[dict]:
    """Devolve os looks PRÓPRIOS da conta, opcionalmente filtrados por nome.

    O filtro `ownership=private` é o que torna isso viável: sem ele a API pagina
    todo o catálogo público (197 páginas, ~210 s) para achar os mesmos avatares
    que o recorte privado entrega em 2 páginas.
    """
    achados, token = [], None
    while True:
        url = (f"{API}/avatars/looks?limit=50&ownership=private"
               + (f"&token={urllib.parse.quote(token)}" if token else ""))
        d = _req("GET", url)
        for a in d.get("data") or []:
            if not filtro or filtro.lower() in (a.get("name") or "").lower():
                achados.append(a)
        token = d.get("next_token")
        if not d.get("has_more") or not token:
            break
    return achados


def gerar_voz(texto: str, destino: Path, passos: int = 32) -> Path:
    """Sintetiza a narração com a voz do catálogo — a mesma que o app usa.

    Antes lia um arquivo solto na raiz do OmniVoice, que só existia numa máquina.
    """
    import fase0_voz as voz
    try:
        voz.falar(texto, destino, passos)
    except RuntimeError as e:
        raise Fase0Erro(str(e)) from e
    finally:
        voz.encerrar()
    return destino


def subir_audio(caminho: Path) -> str:
    """Sobe o WAV como asset e devolve a URL que o /v3/videos aceita."""
    tipos = {".wav": "audio/x-wav", ".mp3": "audio/mpeg", ".m4a": "audio/mp4"}
    tipo = tipos.get(caminho.suffix.lower())
    if not tipo:
        raise Fase0Erro(f"formato de áudio não suportado: {caminho.suffix}")
    d = _req("POST", "https://upload.heygen.com/v1/asset",
             binario=caminho.read_bytes(), content_type=tipo)
    dados = d.get("data", d)
    return dados.get("url") or dados.get("asset_url")


def criar_video(look_id: str, audio_url: str, orientacao: str) -> str:
    corpo = {
        "avatar_id": look_id,
        "voice": {"type": "audio", "audio_url": audio_url},
        "aspect_ratio": "9:16" if orientacao == "vertical" else "16:9",
        "resolution": "1080p",
    }
    d = _req("POST", "/videos", corpo=corpo)
    return (d.get("data") or d).get("video_id") or (d.get("data") or d).get("id")


def esperar(video_id: str, limite_s: int = 1800) -> str:
    inicio = time.time()
    while time.time() - inicio < limite_s:
        d = (_req("GET", f"/videos/{video_id}").get("data") or {})
        estado = d.get("status")
        if estado in ("completed", "success"):
            return d.get("video_url")
        if estado in ("failed", "error"):
            raise Fase0Erro(f"HeyGen falhou: {d.get('error') or d}")
        print(f"  ... {estado} ({int(time.time()-inicio)}s)", flush=True)
        time.sleep(15)
    raise Fase0Erro("Tempo esgotado esperando o HeyGen.")


def baixar(url: str, destino: Path) -> Path:
    with urllib.request.urlopen(url) as r, open(destino, "wb") as f:
        f.write(r.read())
    return destino


def _duracao(arquivo: Path, fluxo: str) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", f"{fluxo}:0",
         "-show_entries", "stream=duration", "-of", "default=nw=1:nk=1", str(arquivo)],
        capture_output=True, text=True).stdout.strip()
    try:
        return float(out)
    except ValueError:
        return 0.0


def remuxar(video: Path, audio: Path, destino: Path) -> Path:
    """Troca o áudio do HeyGen pelo WAV original.

    O HeyGen aplica loudnorm no retorno, o que achata a dinâmica e come SNR.
    O vídeo já está sincronizado com esse mesmo áudio, então a troca é segura.

    SEM `-shortest`: ele fecha pelo fluxo mais curto e ainda come o priming do
    AAC — medido: vídeo 2,00 s + WAV 2,30 s saíam com 1,963 s de áudio, a última
    palavra amputada. Se o WAV for mais longo, o último quadro é segurado.
    """
    dv, da = _duracao(video, "v"), _duracao(audio, "a")
    if da > dv + 0.001:
        v = ["-vf", f"tpad=stop_mode=clone:stop_duration={da - dv + 0.04:.4f}",
             "-c:v", "libx264", "-crf", "16", "-preset", "medium", "-pix_fmt", "yuv420p"]
    else:
        v = ["-c:v", "copy"]
    subprocess.run([
        "ffmpeg", "-y", "-hide_banner", "-v", "error",
        "-i", str(video), "-i", str(audio),
        "-map", "0:v:0", "-map", "1:a:0", *v,
        "-c:a", "aac", "-b:a", "256k",
        "-t", f"{max(da, dv):.6f}", str(destino),
    ], check=True)
    return destino


def main() -> None:
    try:
        _main()
    except Fase0Erro as e:
        sys.exit(str(e))


def _main() -> None:
    ap = argparse.ArgumentParser(description="Fase 0 do PMF Cut: roteiro -> voz -> avatar")
    ap.add_argument("--roteiro", help="arquivo .txt com a narração")
    ap.add_argument("--avatar", help="look_id do HeyGen")
    ap.add_argument("--out", default="fase0", help="pasta de saída")
    ap.add_argument("--orientacao", choices=["vertical", "horizontal"], default="vertical")
    ap.add_argument("--passos", type=int, default=32, help="passos de difusão do OmniVoice")
    ap.add_argument("--so-voz", action="store_true", help="para depois da voz, sem gastar crédito")
    ap.add_argument("--listar-avatares", action="store_true")
    a = ap.parse_args()

    if a.listar_avatares:
        for v in listar_avatares():
            print(f"{v['id']}  {v.get('name'):<28} {v.get('avatar_type'):<14} {v.get('preferred_orientation')}")
        return

    if not a.roteiro:
        ap.error("--roteiro é obrigatório")

    texto = Path(a.roteiro).read_text(encoding="utf-8").strip()
    saida = Path(a.out)
    saida.mkdir(parents=True, exist_ok=True)

    print(f"[1/5] voz ({len(texto)} caracteres, {a.passos} passos)")
    wav = gerar_voz(texto, saida / "voz.wav", a.passos)
    print(f"      {wav}")
    if a.so_voz:
        print("Parado antes do HeyGen (--so-voz). Nenhum crédito gasto.")
        return

    if not a.avatar:
        ap.error("--avatar é obrigatório quando o HeyGen roda")

    print("[2/5] subindo áudio")
    url = subir_audio(wav)
    print("[3/5] criando vídeo (ESTE PASSO É PAGO)")
    vid = criar_video(a.avatar, url, a.orientacao)
    print(f"      video_id={vid}")
    print("[4/5] renderizando")
    remoto = esperar(vid)
    bruto = baixar(remoto, saida / "heygen_bruto.mp4")
    print("[5/5] remuxando com o áudio original")
    final = remuxar(bruto, wav, saida / "fase0.mp4")
    print(f"\nPronto: {final}\nEntra na Fase 1 do PMF Cut como material bruto.")


if __name__ == "__main__":
    main()
