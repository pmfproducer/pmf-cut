"""PMF Cut — servidor da Fase 0 (geração, antes do corte).

O app é um hub de peças, não uma esteira: roteiro, voz, avatar e vídeo têm
estado próprio e se abrem em qualquer ordem. Só o vídeo é pago.

Rotas:
  /                       o app (assets/fase0/)
  /assets/<arquivo>       arquivos do app
  /media/<caminho>        áudio e vídeo da pasta de trabalho
  /api/estado    GET      tudo que a pasta já tem + saldo da carteira
  /api/roteiro   POST     {texto} → salva e divide em blocos
  /api/voz       POST     {bloco?, passos} → fala tudo, ou refaz um bloco só
  /api/vozes     GET      catálogo de vozes disponíveis
  /api/vozes     POST     {origem, inicio, duracao, nome, texto?} → clona uma voz nova
  /api/escolher-voz POST  {voz} → define a voz do projeto
  /api/pro-corte POST     copia o fase0.mp4 para a pasta que a Fase 1 lê
  /api/avatar    POST     {id, nome, orientacao} → guarda a escolha
  /api/fechar-voz POST    marca a voz como fechada (libera o vídeo)
  /api/avatares  GET      looks próprios do HeyGen (em cache)
  /api/video     POST     dispara o render PAGO
  /api/job/<id>  GET      progresso de qualquer tarefa longa

Uso:
    uv run helpers/fase0_server.py --out projeto/ [--port 4830]
"""
from __future__ import annotations

import argparse
import json
import mimetypes
import re
import threading
import traceback
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

import fase0_gerar as f0
import fase0_voz as voz

APP = Path(__file__).resolve().parent.parent / "assets" / "fase0"
TRABALHO = Path("fase0")
JOBS: dict[str, dict] = {}
_avatares: list[dict] = []


def _ler(nome: str, padrao):
    p = TRABALHO / nome
    if not p.exists():
        return padrao
    return json.loads(p.read_text(encoding="utf-8")) if nome.endswith(".json") \
        else p.read_text(encoding="utf-8")


def _escrever(nome: str, dados) -> None:
    p = TRABALHO / nome
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(dados, ensure_ascii=False, indent=1) if nome.endswith(".json")
                 else dados, encoding="utf-8")


def _job(alvo, *args) -> str:
    jid = uuid.uuid4().hex[:12]
    JOBS[jid] = {"estado": "rodando", "passo": "começando", "resultado": None, "erro": None}

    def correr():
        try:
            JOBS[jid]["resultado"] = alvo(jid, *args)
            JOBS[jid]["estado"] = "pronto"
        except Exception as e:
            JOBS[jid]["estado"] = "erro"
            JOBS[jid]["erro"] = f"{type(e).__name__}: {e}"
            traceback.print_exc()

    threading.Thread(target=correr, daemon=True).start()
    return jid


def _tarefa_voz(jid: str, qual: int | None, passos: int) -> dict:
    escolhida = (_ler("voz.json", None) or {}).get("voz", voz.VOZ_PADRAO)
    blocos = _ler("blocos.json", [])
    if not blocos:
        raise RuntimeError("escreva o roteiro antes")
    alvos = [b for b in blocos if qual is None or b["i"] == qual]
    for n, b in enumerate(alvos, 1):
        JOBS[jid]["passo"] = (f"bloco {b['i']}" if qual is not None
                              else f"bloco {n} de {len(alvos)}")
        arq = TRABALHO / "blocos" / f"{b['i']:02d}.wav"
        b["dur"] = round(voz.falar(b["texto"], arq, passos, escolhida), 2)
        b["arquivo"] = f"blocos/{b['i']:02d}.wav"
        b["picos"] = voz.picos(arq)
        _escrever("blocos.json", blocos)
    if all(b.get("arquivo") for b in blocos):
        JOBS[jid]["passo"] = "juntando"
        total = voz.juntar([TRABALHO / b["arquivo"] for b in blocos], TRABALHO / "voz.wav")
        return {"blocos": blocos, "total": round(total, 2)}
    return {"blocos": blocos, "total": None}


def _tarefa_clonar(jid: str, origem: str, inicio: float, duracao: float,
                   nome: str, texto: str | None) -> dict:
    chave = re.sub(r"[^a-z0-9]+", "-", nome.lower()).strip("-") or "voz"
    JOBS[jid]["passo"] = "cortando a referência"
    ref = voz.extrair_trecho(Path(origem).expanduser(), inicio, duracao,
                             TRABALHO / "refs" / f"{chave}.wav")
    if not texto:
        JOBS[jid]["passo"] = "transcrevendo a referência"
        texto = voz.transcrever(ref)
    JOBS[jid]["passo"] = "criando o clone"
    dados = voz.clonar(ref, texto, chave, nome)
    _escrever("voz.json", {"voz": chave})
    _zerar_audio()
    return {"chave": chave, **dados}


def _tarefa_video(jid: str) -> dict:
    wav = TRABALHO / "voz.wav"
    av = _ler("avatar.json", None)
    if not wav.exists():
        raise RuntimeError("feche a voz antes de gerar o vídeo")
    if not av:
        raise RuntimeError("escolha um avatar")
    JOBS[jid]["passo"] = "subindo o áudio"
    url = f0.subir_audio(wav)
    JOBS[jid]["passo"] = "criando o vídeo"
    vid = f0.criar_video(av["id"], url, av.get("orientacao", "vertical"))
    JOBS[jid]["passo"] = "renderizando"
    remoto = f0.esperar(vid)
    JOBS[jid]["passo"] = "baixando"
    bruto = f0.baixar(remoto, TRABALHO / "heygen_bruto.mp4")
    JOBS[jid]["passo"] = "trocando pelo áudio original"
    f0.remuxar(bruto, wav, TRABALHO / "fase0.mp4")
    return {"arquivo": "fase0.mp4"}


def _zerar_audio() -> None:
    """Trocar a voz invalida o que já foi falado: os blocos antigos ficariam
    numa voz e os novos noutra, sem nada na tela dizendo isso."""
    blocos = _ler("blocos.json", [])
    for b in blocos:
        b["arquivo"] = b["dur"] = b["picos"] = None
    if blocos:
        _escrever("blocos.json", blocos)
    for f in ("voz.wav", "voz_fechada"):
        alvo = TRABALHO / f
        if alvo.exists():
            alvo.unlink()


def _saldo():
    try:
        d = f0._req("GET", "/users/me").get("data", {})
        return (d.get("wallet") or {}).get("remaining_balance")
    except Exception:
        return None


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _envia(self, corpo: bytes, tipo: str, status: int = 200):
        self.send_response(status)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(corpo)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(corpo)

    def _json(self, dados, status: int = 200):
        self._envia(json.dumps(dados, ensure_ascii=False).encode(), "application/json", status)

    def _arquivo(self, caminho: Path):
        if not caminho.is_file():
            return self._envia(b"nao encontrado", "text/plain", 404)
        tipo = mimetypes.guess_type(caminho.name)[0] or "application/octet-stream"
        self._envia(caminho.read_bytes(), tipo)

    def do_GET(self):
        rota = unquote(urlparse(self.path).path)
        if rota == "/":
            return self._arquivo(APP / "index.html")
        if rota.startswith("/assets/"):
            return self._arquivo(APP / rota[8:])
        if rota.startswith("/media/"):
            return self._arquivo(TRABALHO / rota[7:])
        if rota == "/api/estado":
            return self._json({
                "pasta": str(TRABALHO.resolve()),
                "saldo": _saldo(),
                "roteiro": _ler("roteiro.txt", ""),
                "blocos": _ler("blocos.json", []),
                "avatar": _ler("avatar.json", None),
                "tem_voz": (TRABALHO / "voz.wav").exists(),
                "voz_fechada": (TRABALHO / "voz_fechada").exists(),
                "tem_video": (TRABALHO / "fase0.mp4").exists(),
            })
        if rota == "/api/vozes":
            return self._json({"vozes": voz.catalogo(),
                               "escolhida": (_ler("voz.json", None) or {}).get("voz", voz.VOZ_PADRAO)})
        if rota == "/api/avatares":
            global _avatares
            if not _avatares:
                _avatares = f0.listar_avatares()
            return self._json(_avatares)
        if rota.startswith("/api/job/"):
            return self._json(JOBS.get(rota[9:]) or {"estado": "desconhecido"})
        return self._envia(b"nao encontrado", "text/plain", 404)

    def do_POST(self):
        rota = urlparse(self.path).path
        corpo = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")

        if rota == "/api/roteiro":
            texto = (corpo.get("texto") or "").strip()
            if not texto:
                return self._json({"erro": "roteiro vazio"}, 400)
            antigos = {b["texto"]: b for b in _ler("blocos.json", [])}
            blocos = []
            for i, t in enumerate(voz.dividir(texto), 1):
                velho = antigos.get(t)          # texto igual mantém o áudio já feito
                blocos.append({"i": i, "texto": t,
                               "arquivo": velho.get("arquivo") if velho else None,
                               "dur": velho.get("dur") if velho else None,
                               "picos": velho.get("picos") if velho else None})
            _escrever("roteiro.txt", texto)
            _escrever("blocos.json", blocos)
            return self._json({"blocos": blocos})

        if rota == "/api/voz":
            qual = corpo.get("bloco")
            return self._json({"job": _job(_tarefa_voz,
                                           int(qual) if qual is not None else None,
                                           int(corpo.get("passos", 32)))})

        if rota == "/api/avatar":
            if not corpo.get("id"):
                return self._json({"erro": "avatar sem id"}, 400)
            _escrever("avatar.json", corpo)
            return self._json(corpo)

        if rota == "/api/escolher-voz":
            escolha = corpo.get("voz")
            if escolha not in voz.catalogo():
                return self._json({"erro": "voz desconhecida"}, 400)
            atual = (_ler("voz.json", None) or {}).get("voz", voz.VOZ_PADRAO)
            _escrever("voz.json", {"voz": escolha})
            if escolha != atual:
                _zerar_audio()
            return self._json({"voz": escolha, "blocos": _ler("blocos.json", [])})

        if rota == "/api/vozes":
            origem = (corpo.get("origem") or "").strip()
            if not origem or not Path(origem).expanduser().exists():
                return self._json({"erro": "arquivo de referência não encontrado"}, 400)
            if not (corpo.get("nome") or "").strip():
                return self._json({"erro": "dê um nome para a voz"}, 400)
            return self._json({"job": _job(
                _tarefa_clonar, origem, float(corpo.get("inicio", 0)),
                float(corpo.get("duracao", 9)), corpo["nome"].strip(),
                (corpo.get("texto") or "").strip() or None)})

        if rota == "/api/pro-corte":
            mp4 = TRABALHO / "fase0.mp4"
            if not mp4.exists():
                return self._json({"erro": "gere o vídeo antes"}, 400)
            destino = TRABALHO.parent / "videos"
            destino.mkdir(parents=True, exist_ok=True)
            alvo = destino / "fase0.mp4"
            alvo.write_bytes(mp4.read_bytes())
            return self._json({"destino": str(alvo.resolve())})

        if rota == "/api/fechar-voz":
            if not (TRABALHO / "voz.wav").exists():
                return self._json({"erro": "fale todos os blocos antes"}, 400)
            (TRABALHO / "voz_fechada").write_text("", encoding="utf-8")
            return self._json({"ok": True})

        if rota == "/api/video":
            return self._json({"job": _job(_tarefa_video)})

        return self._envia(b"nao encontrado", "text/plain", 404)


def main() -> None:
    global TRABALHO
    ap = argparse.ArgumentParser(description="Servidor da Fase 0 do PMF Cut")
    ap.add_argument("--out", default="fase0", help="pasta de trabalho")
    ap.add_argument("--port", type=int, default=4830)
    a = ap.parse_args()
    TRABALHO = Path(a.out)
    TRABALHO.mkdir(parents=True, exist_ok=True)
    print(f"Fase 0 em http://127.0.0.1:{a.port}  (pasta: {TRABALHO.resolve()})")
    try:
        ThreadingHTTPServer(("127.0.0.1", a.port), Handler).serve_forever()
    finally:
        voz.encerrar()


if __name__ == "__main__":
    main()
