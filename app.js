/* Soru Kontrol — hoca inceleme ekranı
   Erişim: tek yol kod + SECURITY DEFINER RPC. Tablolara doğrudan erişim kapalı.
   Körlük: sorularim() yalnızca o hocanın kendi işaretlerini döner. */

const SB_URL  = "https://rbjrnevngfuribasrnph.supabase.co";
const SB_ANON = "sb_publishable_yK1dNA6CGKIQ88U3gp53xA_nBLQGNVJ";
const sb = window.supabase.createClient(SB_URL, SB_ANON, { auth: { persistSession: false } });

const KUSURLAR = [
  ["cevap",  "cevap yanlış"],
  ["sik",    "şık sorunu"],
  ["sekil",  "şekil"],
  ["yazim",  "yazım/dil"],
  ["seviye", "seviye"],
  ["cikti",  "çıktıya uymuyor"],
  ["ipucu",  "cevabı ele veriyor"],
  ["baglam", "bağlam zayıf"],
];

const $ = (s) => document.querySelector(s);
let kod = null, ad = "", sorular = [], i = 0, acilis = Date.now(), yazmaZaman = null;

/* ── Giriş ────────────────────────────────────────────────────────── */

async function girisDene(gelenKod) {
  const k = (gelenKod || "").trim().toUpperCase();
  if (k.length < 4) { $("#giris-uyari").textContent = "Kodu eksiksiz girin."; return false; }
  $("#gir").disabled = true;
  $("#giris-uyari").textContent = "";
  try {
    const { data, error } = await sb.rpc("giris", { p_kod: k });
    if (error) throw error;
    if (!data || !data.ok) {
      $("#giris-uyari").textContent = "Kod tanınmadı. Size iletilen kodu kontrol edin.";
      $("#gir").disabled = false;
      return false;
    }
    kod = k; ad = data.ad;
    try { localStorage.setItem("sk:kod", k); } catch (e) {}
    await baslat();
    return true;
  } catch (e) {
    $("#giris-uyari").textContent = "Bağlanılamadı. İnternet bağlantınızı kontrol edip tekrar deneyin.";
    $("#gir").disabled = false;
    return false;
  }
}

async function baslat() {
  const { data, error } = await sb.rpc("sorularim", { p_kod: kod });
  if (error || !data) { $("#giris-uyari").textContent = "Sorular alınamadı."; $("#gir").disabled = false; return; }
  sorular = data.map((s) => ({
    id: s.soru_id, kart: s.kart_html,
    durum: s.durum || "", kusurlar: s.kusurlar || [], not: s.aciklama || "",
  }));
  $("#giris").style.display = "none";
  $("#uygulama").style.display = "flex";
  $("#ad").textContent = ad;
  kusurlariKur();
  // ilk girişte kılavuz kendiliğinden açılır, sonra üst çubuktan ulaşılır
  let gordu = null;
  try { gordu = localStorage.getItem("sk:kilavuz"); } catch (e) {}
  if (!gordu) kilavuzAc(true);
  // kaldığı yerden devam: ilk işaretsiz soru
  const ilk = sorular.findIndex((s) => !s.durum);
  i = ilk === -1 ? 0 : ilk;
  goster();
}

/* ── Gösterim ─────────────────────────────────────────────────────── */

function kusurlariKur() {
  $("#kusurlar").innerHTML = KUSURLAR
    .map(([k, etiket]) => `<button class="k" data-kusur="${k}">${etiket}</button>`).join("");
}

function goster() {
  const s = sorular[i];
  if (!s) return;
  const [soruHtml, cevapHtml] = ayir(s.kart);
  $("#soru-kart").innerHTML = soruHtml;
  $("#cevap-kart").innerHTML = cevapHtml;
  document.querySelectorAll(".d").forEach((b) => b.classList.toggle("secili", b.dataset.durum === s.durum));
  document.querySelectorAll(".k").forEach((b) => b.classList.toggle("secili", s.kusurlar.includes(b.dataset.kusur)));
  $("#not").value = s.not;
  $("#geri").disabled = i === 0;
  $("#ileri").disabled = i === sorular.length - 1;
  $("#durum-yazi").textContent = "";
  $("#durum-yazi").classList.remove("uyar");
  $("#not").classList.remove("gerekli");
  $("#bitti").style.display = "none";
  ilerlemeYaz();
  tutamagiYaz();
  panelAc(false);          // yeni soru katlı açılır, kart tam görünür
  acilis = Date.now();
  window.scrollTo({ top: 0, behavior: "instant" });
}

// kart_html iki kartı taşır: soru ve cevap, "<!--cevap-->" ile ayrılmış
function ayir(html) {
  const p = html.split("<!--cevap-->");
  return [p[0] || "", p[1] || ""];
}

function ilerlemeYaz() {
  const biten = sorular.filter((s) => s.durum).length;
  $("#cubuk").style.width = (100 * biten / Math.max(sorular.length, 1)) + "%";
  $("#sayac").textContent = `${i + 1}. soru · ${biten} / ${sorular.length} işaretlendi`;
}

/* ── Kaydetme ─────────────────────────────────────────────────────── */

// "uygun" dışındaki her kararda gerekçe zorunlu — sunucu da aynı kuralı uyguluyor
function notGerekli(s) { return (s.durum === "supheli" || s.durum === "hatali") && s.not.trim().length < 3; }

function notUyar(goster) {
  $("#not").classList.toggle("gerekli", goster);
  $("#durum-yazi").classList.toggle("uyar", goster);
  if (goster) {
    $("#durum-yazi").textContent = "Bu karar için kısa bir not yazın — neyin sorunlu olduğunu belirtin.";
    $("#not").focus();
  }
}

async function kaydet(ilerle) {
  const s = sorular[i];
  if (!s) return;
  s.not = $("#not").value.trim();
  if (!s.durum && !s.not && s.kusurlar.length === 0) {
    if (ilerle) ileri();
    return;
  }
  if (notGerekli(s)) { notUyar(true); return; }
  notUyar(false);
  $("#durum-yazi").textContent = "kaydediliyor…";
  const { data, error } = await sb.rpc("isaretle", {
    p_kod: kod, p_soru: s.id, p_durum: s.durum || null,
    p_kusurlar: s.kusurlar, p_aciklama: s.not,
    p_sure: Math.min(Math.round((Date.now() - acilis) / 1000), 3600),
  });
  if (error || !data || !data.ok) {
    if (data && data.hata === "not_gerekli") { notUyar(true); return; }
    $("#durum-yazi").textContent = "⚠ kaydedilemedi — internet bağlantınızı kontrol edin, işaret ekranda duruyor";
    return;
  }
  $("#durum-yazi").textContent = "kaydedildi ✓";
  ilerlemeYaz();
  tutamagiYaz();
  if (ilerle) ileri();
}

function ileri() {
  if (i < sorular.length - 1) { i++; goster(); }
  else if (sorular.every((s) => s.durum)) {
    $("#bitti").style.display = "block";
    $("#durum-yazi").textContent = "hepsi tamam";
  }
}

/* ── Mobil karar paneli: katlanır ─────────────────────────────────── */
// 22 Eyl: sabit panel telefonda cevap kartının bir kısmını kapatıyordu. Panel artık
// katlı başlar, tutamağa basınca açılır. Kaydetme sunucuda olduğu için ilerleme etkilenmez.
const ETIKET = { uygun: "uygun", supheli: "şüpheli", hatali: "hatalı" };

function panelAc(ac) {
  document.body.classList.toggle("karar-acik", ac);
  $("#tutamak").setAttribute("aria-expanded", ac ? "true" : "false");
}

function tutamagiYaz() {
  const s = sorular[i];
  const rozet = $("#tutamak-rozet");
  const d = s && s.durum;
  rozet.className = "durum-rozet " + (d || "bos");
  rozet.textContent = d ? ETIKET[d] : "işaretlenmedi";
  $("#tutamak .tutamak-yazi").textContent = d ? "Değerlendirmeyi düzenle" : "Değerlendir";
}

$("#tutamak").addEventListener("click", () => {
  panelAc(!document.body.classList.contains("karar-acik"));
});

/* ── Kılavuz ──────────────────────────────────────────────────────── */

function kilavuzAc(ac) {
  $("#kilavuz").hidden = !ac;
  if (ac) {
    $("#kilavuz .kilavuz-govde").scrollTop = 0;
    $("#kilavuz-kapat").focus();
  } else {
    try { localStorage.setItem("sk:kilavuz", "1"); } catch (e) {}
  }
}

$("#kilavuz-ac").addEventListener("click", () => kilavuzAc(true));
$("#kilavuz-kapat").addEventListener("click", () => kilavuzAc(false));
$("#kilavuz-basla").addEventListener("click", () => kilavuzAc(false));
$("#kilavuz").addEventListener("click", (e) => { if (e.target.id === "kilavuz") kilavuzAc(false); });

/* ── Olaylar ──────────────────────────────────────────────────────── */

$("#gir").addEventListener("click", () => girisDene($("#kod").value));
$("#kod").addEventListener("keydown", (e) => { if (e.key === "Enter") girisDene($("#kod").value); });

$("#geri").addEventListener("click", async () => { await kaydet(false); if (i > 0) { i--; goster(); } });
$("#not").addEventListener("blur", () => { if (!notGerekli(sorular[i] || {durum:""})) notUyar(false); });
$("#ileri").addEventListener("click", () => kaydet(true));
$("#kaydet-ilerle").addEventListener("click", () => kaydet(true));

$("#cikis").addEventListener("click", () => {
  try { localStorage.removeItem("sk:kod"); } catch (e) {}
  location.reload();
});

document.addEventListener("click", (e) => {
  if (!$("#kilavuz").hidden) return;
  const d = e.target.closest(".d");
  if (d) {
    const s = sorular[i];
    s.durum = s.durum === d.dataset.durum ? "" : d.dataset.durum;
    document.querySelectorAll(".d").forEach((b) => b.classList.toggle("secili", b.dataset.durum === s.durum));
    s.not = $("#not").value.trim();
    if (notGerekli(s)) { notUyar(true); return; }
    kaydet(false);
    return;
  }
  const k = e.target.closest(".k");
  if (k) {
    const s = sorular[i];
    const set = new Set(s.kusurlar);
    set.has(k.dataset.kusur) ? set.delete(k.dataset.kusur) : set.add(k.dataset.kusur);
    s.kusurlar = [...set];
    if (s.kusurlar.length && !s.durum) s.durum = "supheli";
    document.querySelectorAll(".k").forEach((b) => b.classList.toggle("secili", s.kusurlar.includes(b.dataset.kusur)));
    document.querySelectorAll(".d").forEach((b) => b.classList.toggle("secili", b.dataset.durum === s.durum));
    kaydet(false);
  }
});

// not yazarken 1,5 sn sessizlikten sonra otomatik kaydet (hoca kaydet'e basmayı unutmasın)
$("#not").addEventListener("input", () => {
  clearTimeout(yazmaZaman);
  yazmaZaman = setTimeout(() => kaydet(false), 1500);
});

document.addEventListener("keydown", (e) => {
  if (!$("#kilavuz").hidden) { if (e.key === "Escape") kilavuzAc(false); return; }
  if ($("#uygulama").style.display === "none") return;
  const yaziAlaninda = ["TEXTAREA", "INPUT"].includes(document.activeElement.tagName);
  if (yaziAlaninda) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); kaydet(true); }
    return;
  }
  if (e.key === "1" || e.key === "2" || e.key === "3") {
    document.querySelector(`.d[data-durum="${{1:"uygun",2:"supheli",3:"hatali"}[e.key]}"]`).click();
  } else if (e.key === "Enter" || e.key === "ArrowRight") { kaydet(true); }
  else if (e.key === "ArrowLeft" && i > 0) { kaydet(false).then?.(() => {}); i--; goster(); }
});

window.addEventListener("beforeunload", () => {
  const s = sorular[i];
  if (s && $("#not") && $("#not").value.trim() !== s.not) kaydet(false);
});

/* hatırlanan kodla otomatik giriş */
(() => {
  let k = null;
  try { k = localStorage.getItem("sk:kod"); } catch (e) {}
  const url = new URLSearchParams(location.search).get("kod");
  if (url) { $("#kod").value = url.toUpperCase(); girisDene(url); }
  else if (k) { $("#kod").value = k; girisDene(k); }
  else $("#kod").focus();
})();
