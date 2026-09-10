"""Worker persistente do OmniVoice: carrega o modelo uma vez e fica servindo.

Protocolo: uma linha JSON por pedido no stdin, uma linha JSON por resposta no
stdout. Existe porque carregar o modelo custa ~10 s — inviável para refazer um
bloco de 3 s.

Pedidos:
  {"op":"falar",  "voz":"vozes/pablo.pt", "texto":"...", "saida":"/x.wav", "passos":32}
  {"op":"clonar", "ref":"/ref.wav", "texto":"...", "saida":"vozes/nova.pt"}
Respostas: {"ok":true, ...} | {"ok":false, "erro":"..."}
"""
import json
import sys

import soundfile as sf
import torch

from omnivoice import OmniVoice, VoiceClonePrompt

SR = 24000
_prompts: dict[str, object] = {}   # cache: carregar o .pt custa I/O a cada bloco


def _prompt(caminho: str):
    if caminho not in _prompts:
        _prompts[caminho] = VoiceClonePrompt.load(caminho)
    return _prompts[caminho]


def main() -> None:
    modelo = OmniVoice.from_pretrained(
        "k2-fsa/OmniVoice", device_map="mps", dtype=torch.float16
    )
    print(json.dumps({"pronto": True}), flush=True)

    for linha in sys.stdin:
        linha = linha.strip()
        if not linha:
            continue
        try:
            ped = json.loads(linha)
            op = ped.get("op", "falar")

            if op == "clonar":
                p = modelo.create_voice_clone_prompt(
                    ref_audio=ped["ref"], ref_text=ped["texto"],
                )
                p.save(ped["saida"])
                _prompts[ped["saida"]] = p
                print(json.dumps({"ok": True}), flush=True)
                continue

            audio = modelo.generate(
                text=ped["texto"],
                voice_clone_prompt=_prompt(ped["voz"]),
                num_step=int(ped.get("passos", 32)),
            )[0]
            sf.write(ped["saida"], audio, SR)
            print(json.dumps({"ok": True, "dur": len(audio) / SR}), flush=True)
        except Exception as e:
            print(json.dumps({"ok": False, "erro": f"{type(e).__name__}: {e}"}), flush=True)


if __name__ == "__main__":
    main()
