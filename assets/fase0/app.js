const $ = (s) => document.querySelector(s);
const est = { blocos: [], avatares: [], avatar: null, saldo: null, vozes: null,
              filtro: { busca: "", tipo: "", formato: "portrait" } };

const mostrar = (s) => $(s).classList.remove("oculto");
const esconder = (s) => $(s).classList.add("oculto");

function abrir(peca) {
  document.querySelectorAll(".peca").forEach((b) =>
    b.classList.toggle("ativa", b.dataset.peca === peca));
  ["roteiro", "voz", "avatar", "video"].forEach((p) =>
    $(`#p-${p}`).classList.toggle("oculto", p !== peca));
  if (peca === "avatar") carregarAvatares();
}
document.querySelectorAll(".peca").forEach((b) =>
  b.addEventListener("click", () => abrir(b.dataset.peca)));

function status(txt) {
  if (!txt) return esconder("#status");
  $("#statusTxt").textContent = txt;
  mostrar("#status");
}
function falhar(msg) {
  status(null);
  $("#erro").textContent = msg;
  mostrar("#erro");
}

async function api(rota, corpo) {
  const r = await fetch(rota, corpo
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) }
    : undefined);
  const d = await r.json();
  if (d.erro) throw new Error(d.erro);
  return d;
}

/** Acompanha uma tarefa longa do servidor até acabar, mostrando o passo atual. */
async function esperar(job) {
  for (;;) {
    const j = await api(`/api/job/${job}`);
    if (j.estado === "pronto") return j.resultado;
    if (j.estado === "erro") throw new Error(j.erro);
    status(j.passo || "trabalhando");
    await new Promise((r) => setTimeout(r, 900));
  }
}

// ---------- estados do trilho ----------
function pintarEstados() {
  const comAudio = est.blocos.filter((b) => b.arquivo).length;
  const total = est.blocos.length;

  const por = (id, texto, classe) => {
    const el = $(`#e-${id}`);
    el.textContent = texto;
    el.className = `estado ${classe || ""}`;
    $(`.peca[data-peca="${id}"]`).classList.toggle("vazia", !classe);
  };

  por("roteiro", total ? "pronto" : "vazio", total ? "pronto" : "");
  por("voz",
    !total ? "vazio" : comAudio === total ? "pronto" : comAudio ? `${comAudio}/${total}` : "vazio",
    comAudio === total && total ? "pronto" : "");
  const med = $("#medidor");
  med.innerHTML = "";
  for (const b of est.blocos) {
    const i = document.createElement("i");
    if (b.arquivo) i.className = "feito";
    med.append(i);
  }
  $("#btFechar").classList.toggle("oculto", !(total && comAudio === total));

  por("avatar", est.avatar ? "pronto" : "vazio", est.avatar ? "pronto" : "");
  por("video", $("#caixaVideo").classList.contains("oculto") ? "vazio" : "pronto",
    $("#caixaVideo").classList.contains("oculto") ? "" : "pronto");
}

// ---------- roteiro ----------
$("#btDividir").addEventListener("click", async () => {
  esconder("#erro");
  try {
    const d = await api("/api/roteiro", { texto: $("#roteiro").value });
    est.blocos = d.blocos;
    pintarBlocos();
    pintarEstados();
    abrir("voz");
  } catch (e) {
    falhar(`Não deu pra dividir o roteiro — ${e.message}`);
  }
});
$("#roteiro").addEventListener("input", () => {
  const n = $("#roteiro").value.length;
  $("#meta-roteiro").textContent = n ? `${n} caracteres · ~${Math.round(n / 14)}s` : "";
});

// ---------- voz ----------
function pintarBlocos() {
  const alvo = $("#blocos");
  alvo.innerHTML = "";
  if (!est.blocos.length) {
    alvo.innerHTML = `<p class="vazio-msg">Escreve o roteiro primeiro.</p>`;
    return;
  }
  for (const b of est.blocos) {
    const linha = document.createElement("div");
    linha.className = "bloco" + (b.arquivo ? "" : " sem-audio");
    const cima = document.createElement("div");
    cima.className = "cima";
    const num = document.createElement("span");
    num.className = "num";
    num.textContent = String(b.i).padStart(2, "0");
    const txt = document.createElement("span");
    txt.className = "txt";
    txt.textContent = b.texto;
    const dur = document.createElement("span");
    dur.className = "dur";
    dur.textContent = b.dur ? `${b.dur.toFixed(1)}s` : "—";
    cima.append(num, txt, dur);

    if (b.arquivo) {
      const ouvir = document.createElement("button");
      ouvir.className = "acao";
      ouvir.textContent = "ouvir";
      ouvir.addEventListener("click", () => tocar(b.arquivo));
      cima.append(ouvir);
    }
    const refazer = document.createElement("button");
    refazer.className = "acao";
    refazer.textContent = b.arquivo ? "refazer" : "falar";
    refazer.addEventListener("click", () => falar(b.i));
    cima.append(refazer);
    linha.append(cima);

    if (b.picos?.length) {
      const env = document.createElement("div");
      env.className = "onda";
      env.innerHTML = onda(b.picos);
      linha.append(env);
    }
    alvo.append(linha);
  }
  const feitos = est.blocos.filter((b) => b.arquivo);
  $("#meta-voz").textContent = `${est.blocos.length} blocos`;
  $("#totalVoz").textContent = feitos.length === est.blocos.length
    ? `${feitos.reduce((s, b) => s + (b.dur || 0), 0).toFixed(1)}s falados`
    : `${feitos.length} de ${est.blocos.length} falados`;
}

/** Desenha o envelope do bloco. Os picos vêm prontos do servidor (0..1). */
function onda(picos) {
  const L = 1000, A = 26, passo = L / picos.length;
  const larg = Math.max(1.2, passo * 0.5);
  const raio = Math.min(larg / 2, 1.4);   // sem isso as barras viram bolinhas ao esticar
  const barras = picos.map((p, i) => {
    const h = Math.max(1.4, p * A);
    return `<rect x="${(i * passo).toFixed(2)}" y="${((A - h) / 2).toFixed(2)}" `
      + `width="${larg.toFixed(2)}" height="${h.toFixed(2)}" rx="${raio.toFixed(2)}"/>`;
  }).join("");
  return `<svg viewBox="0 0 ${L} ${A}" preserveAspectRatio="none" fill="currentColor"
    fill-opacity="0.55" aria-hidden="true">${barras}</svg>`;
}

function tocar(arquivo) {
  const p = $("#player");
  p.src = `/media/${arquivo}?t=${Date.now()}`;
  mostrar("#player");
  p.play();
}

async function falar(bloco) {
  esconder("#erro");
  if (bloco != null) {
    const linha = $("#blocos").children[est.blocos.findIndex((b) => b.i === bloco)];
    if (linha) linha.classList.add("gerando");
  }
  try {
    const { job } = await api("/api/voz", { bloco, passos: +$("#passos").value });
    const r = await esperar(job);
    est.blocos = r.blocos;
    status(null);
    pintarBlocos();
    pintarEstados();
  } catch (e) {
    falhar(`A voz falhou — ${e.message}`);
    pintarBlocos();
  }
}
$("#btFalarTudo").addEventListener("click", () => falar(null));
$("#btOuvirTudo").addEventListener("click", () => tocar("voz.wav"));
$("#btFechar").addEventListener("click", async () => {
  try {
    await api("/api/fechar-voz", {});
    abrir("avatar");
  } catch (e) {
    falhar(`Não deu pra fechar a voz — ${e.message}`);
  }
});

// ---------- escolha e clonagem de voz ----------
async function carregarVozes() {
  const d = await api("/api/vozes");
  const sel = $("#qualVoz");
  sel.innerHTML = "";
  for (const [chave, v] of Object.entries(d.vozes)) {
    const o = document.createElement("option");
    o.value = chave;
    o.textContent = v.nome;
    o.selected = chave === d.escolhida;
    sel.append(o);
  }
  est.vozes = d.vozes;
  mostrarOrigem(d.escolhida);
}
function mostrarOrigem(chave) {
  $("#origemVoz").textContent = est.vozes?.[chave]?.origem || "";
}
$("#qualVoz").addEventListener("change", async () => {
  const chave = $("#qualVoz").value;
  try {
    const d = await api("/api/escolher-voz", { voz: chave });
    mostrarOrigem(chave);
    est.blocos = d.blocos || [];   // a troca apaga o áudio da voz anterior
    pintarBlocos();
    pintarEstados();
  } catch (e) {
    falhar(`Não deu pra trocar a voz — ${e.message}`);
  }
});
$("#btNovaVoz").addEventListener("click", () => $("#formVoz").classList.toggle("oculto"));

$("#btClonar").addEventListener("click", async () => {
  esconder("#erro");
  $("#btClonar").disabled = true;
  try {
    const { job } = await api("/api/vozes", {
      origem: $("#cvOrigem").value.trim(),
      nome: $("#cvNome").value.trim(),
      inicio: +$("#cvInicio").value,
      duracao: +$("#cvDur").value,
      texto: $("#cvTexto").value.trim(),
    });
    await esperar(job);
    status(null);
    await carregarVozes();
    await carregar();               // o clone novo vira a voz do projeto e zera o áudio
    $("#formVoz").classList.add("oculto");
  } catch (e) {
    falhar(`O clone falhou — ${e.message}`);
  } finally {
    $("#btClonar").disabled = false;
  }
});

// ---------- avatar ----------
async function carregarAvatares() {
  if (est.avatares.length) return pintarAvatares();
  try {
    est.avatares = await api("/api/avatares");
    pintarAvatares();
  } catch (e) {
    falhar(`Não consegui listar os avatares — ${e.message}`);
  }
}
function pintarAvatares() {
  const { busca, tipo, formato } = est.filtro;
  const termo = busca.trim().toLowerCase();
  const lista = est.avatares.filter((a) =>
    (!tipo || a.avatar_type === tipo)
    && a.preferred_orientation === formato
    && (!termo || (a.name || "").toLowerCase().includes(termo)));

  $("#contagem").textContent = `${lista.length} de ${est.avatares.length}`;
  const grade = $("#grade");
  grade.innerHTML = "";
  if (!lista.length) {
    grade.innerHTML = `<p class="vazio-msg">Nenhum avatar com esse filtro.</p>`;
    return;
  }
  for (const a of lista) {
    const b = document.createElement("button");
    b.className = "av" + (est.avatar?.id === a.id ? " sel" : "");
    const img = document.createElement("img");
    // Sem lazy: a grade é montada com o painel em display:none, e imagem lazy
    // dentro de container escondido nunca entra no viewport — não carregava.
    img.loading = "eager";
    img.decoding = "async";
    img.alt = "";
    img.src = a.preview_image_url || "";
    b.append(img);

    if (a.preview_video_url) {          // prévia só roda no hover, não pesa a carga
      const v = document.createElement("video");
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      v.preload = "none";
      v.src = a.preview_video_url;
      b.addEventListener("mouseenter", () => v.play().catch(() => {}));
      b.addEventListener("mouseleave", () => { v.pause(); v.currentTime = 0; });
      b.append(v);
    }
    const tipo = document.createElement("span");
    tipo.className = "tipo";
    tipo.textContent = a.avatar_type === "digital_twin" ? "TWIN" : "FOTO";
    const rot = document.createElement("span");
    rot.className = "rot";
    rot.textContent = a.name;
    b.append(tipo, rot);
    b.addEventListener("click", () => escolher(a));
    grade.append(b);
  }
}
async function escolher(a) {
  const orientacao = est.filtro.formato === "portrait" ? "vertical" : "horizontal";
  est.avatar = await api("/api/avatar", { id: a.id, nome: a.name, orientacao });
  pintarAvatares();
  pintarEstados();
  $("#meta-avatar").textContent = a.name;
  $("#resumoVideo").textContent = `${a.name} · ${est.filtro.formato === "portrait" ? "9:16" : "16:9"}`;
}

$("#busca").addEventListener("input", () => {
  est.filtro.busca = $("#busca").value;
  pintarAvatares();
});
function ligarChips(seletor, campo) {
  document.querySelectorAll(`${seletor} .chip`).forEach((c) => {
    c.addEventListener("click", () => {
      document.querySelectorAll(`${seletor} .chip`).forEach((o) => o.classList.remove("ativo"));
      c.classList.add("ativo");
      est.filtro[campo] = c.dataset[campo];
      pintarAvatares();
    });
  });
}
ligarChips("#chipsTipo", "tipo");
ligarChips("#chipsFormato", "formato");

// ---------- vídeo (pago) ----------
$("#btRender").addEventListener("click", async () => {
  if (!confirm("O render é cobrado da sua carteira HeyGen. Seguir?")) return;
  esconder("#erro");
  $("#btRender").disabled = true;
  try {
    const { job } = await api("/api/video", {});
    const r = await esperar(job);
    status(null);
    $("#final").src = `/media/${r.arquivo}?t=${Date.now()}`;
    mostrar("#caixaVideo");
    pintarEstados();
    carregar();
  } catch (e) {
    falhar(`O render falhou — ${e.message}`);
  } finally {
    $("#btRender").disabled = false;
  }
});

$("#btProCorte").addEventListener("click", async () => {
  esconder("#erro");
  try {
    const d = await api("/api/pro-corte", {});
    $("#destinoCorte").textContent = `Copiado para ${d.destino} — a Fase 1 lê daqui.`;
    mostrar("#destinoCorte");
  } catch (e) {
    falhar(`Não deu pra mandar pro corte — ${e.message}`);
  }
});

// ---------- carga ----------
async function carregar() {
  const s = await api("/api/estado");
  $("#projeto").textContent = s.pasta.split("/").slice(-2).join("/");
  const txt = s.saldo == null ? "saldo indisponível" : `carteira US$ ${s.saldo.toFixed(2)}`;
  $("#saldo").textContent = txt;
  $("#saldo2").textContent = s.saldo == null ? "—" : `US$ ${s.saldo.toFixed(2)}`;
  est.blocos = s.blocos || [];
  est.avatar = s.avatar;
  if (s.roteiro) {
    $("#roteiro").value = s.roteiro;
    $("#roteiro").dispatchEvent(new Event("input"));
  }
  if (s.avatar) {
    $("#meta-avatar").textContent = s.avatar.nome;
    $("#resumoVideo").textContent = `${s.avatar.nome} · ${s.avatar.orientacao === "vertical" ? "9:16" : "16:9"}`;
    est.filtro.formato = s.avatar.orientacao === "vertical" ? "portrait" : "landscape";
  }
  if (s.tem_video) {
    $("#final").src = `/media/fase0.mp4?t=${Date.now()}`;
    mostrar("#caixaVideo");
  }
  pintarBlocos();
  pintarEstados();
  carregarVozes().catch(() => {});
}
carregar().catch((e) => falhar(`O servidor não respondeu — ${e.message}`));
