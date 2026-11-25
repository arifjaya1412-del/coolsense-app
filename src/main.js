import "@fontsource/sora/latin-300.css";
import "@fontsource/sora/latin-400.css";
import "@fontsource/sora/latin-500.css";
import "@fontsource/sora/latin-600.css";
import "./style.css";

import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { StatusBar, Style } from "@capacitor/status-bar";
import { initializeApp } from "firebase/app";
import {
  getDatabase, ref, onValue, update, set, query, limitToLast, serverTimestamp,
} from "firebase/database";
import {
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence,
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  updateProfile, sendPasswordResetEmail, signOut,
} from "firebase/auth";
import {
  Chart, LineController, LineElement, PointElement, LinearScale, CategoryScale, Filler, Tooltip,
} from "chart.js";
import { firebaseConfig, ROOT_PATH, OFFLINE_MS } from "./firebase-config.js";

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Filler, Tooltip);

// ---------------------------------------------------------------
// Konstanta
// ---------------------------------------------------------------
const ZONA = [
  { dari: 16, sampai: 20.5, nama: "Dingin", warna: "--z-cold" },
  { dari: 20.5, sampai: 22.8, nama: "Sejuk nyaman", warna: "--z-cool" },
  { dari: 22.8, sampai: 25.8, nama: "Nyaman optimal", warna: "--z-ok" },
  { dari: 25.8, sampai: 27.1, nama: "Hangat nyaman", warna: "--z-warm" },
  { dari: 27.1, sampai: 40, nama: "Panas", warna: "--z-hot" },
];
const G_MIN = 16, G_MAX = 40;
const RIWAYAT_MAX = 60;
const KONTROL_AWAL = { mode: "auto", ac_manual: false, batas_atas: 27, batas_bawah: 25 };
const TUNGGU_ESP_MS = 12000;
const NATIVE = Capacitor.isNativePlatform();

// ---------------------------------------------------------------
// State
// ---------------------------------------------------------------
const state = {
  sumber: null,          // "firebase" | "demo"
  firebaseOn: false,
  internetOn: navigator.onLine,
  suhu: null, kelembapan: null,
  lastSeen: 0, heartbeat: 0,
  rssi: null, ip: "", uptime: null, sensorOk: null,
  ac: false,
  mode: KONTROL_AWAL.mode, acManual: false,
  batasAtas: 27, batasBawah: 25,
  pending: null,         // { ac, sejak } perintah yang menunggu konfirmasi ESP32
  evaluasiUlang: false,  // khusus mode demo
};
const riwayat = [];
let kirim = async () => {};
let auth = null;

const $ = (id) => document.getElementById(id);
const fmt = (n, d = 1) => (n == null || Number.isNaN(n) ? "–" : Number(n).toLocaleString("id-ID", { minimumFractionDigits: d, maximumFractionDigits: d }));
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const zonaDari = (t) => ZONA.find((z) => t < z.sampai) ?? ZONA[ZONA.length - 1];
const waktuTerakhir = () => Math.max(state.lastSeen || 0, state.heartbeat || 0);
const espOnline = () => state.sumber === "demo" || (waktuTerakhir() > 0 && Date.now() - waktuTerakhir() < OFFLINE_MS);

function sejak(ms) {
  if (!ms) return "belum ada";
  const d = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (d < 5) return "baru saja";
  if (d < 60) return `${d} detik lalu`;
  if (d < 3600) return `${Math.floor(d / 60)} menit lalu`;
  if (d < 86400) return `${Math.floor(d / 3600)} jam lalu`;
  return new Date(ms).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
function durasi(detik) {
  if (detik == null) return "–";
  const j = Math.floor(detik / 3600), m = Math.floor((detik % 3600) / 60);
  if (j >= 24) return `${Math.floor(j / 24)} hari ${j % 24} jam`;
  if (j > 0) return `${j} jam ${m} menit`;
  return `${m} menit ${Math.floor(detik % 60)} detik`;
}
function kualitasSinyal(rssi) {
  if (rssi == null) return "–";
  const k = rssi >= -60 ? "kuat" : rssi >= -70 ? "cukup" : "lemah";
  return `${rssi} dBm, ${k}`;
}

let timerToast;
function toast(teks) {
  const el = $("toast");
  el.textContent = teks;
  el.classList.add("tampil");
  clearTimeout(timerToast);
  timerToast = setTimeout(() => el.classList.remove("tampil"), 2800);
}
function getar() {
  if (NATIVE) Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {});
  else if (navigator.vibrate) navigator.vibrate(18);
}

function tampilkanLayar(nama) {
  ["memuat", "masuk", "utama"].forEach((n) => { $(`layar-${n}`).hidden = n !== nama; });
}

// ---------------------------------------------------------------
// Gauge temperatur
// ---------------------------------------------------------------
const NS = "http://www.w3.org/2000/svg";
const GC = 130, GR = 104;
const sudut = (t) => 135 + ((Math.min(G_MAX, Math.max(G_MIN, t)) - G_MIN) / (G_MAX - G_MIN)) * 270;
const titik = (a, r = GR) => [GC + r * Math.cos((a * Math.PI) / 180), GC + r * Math.sin((a * Math.PI) / 180)];
function busur(a1, a2, r = GR) {
  const [x1, y1] = titik(a1, r), [x2, y2] = titik(a2, r);
  return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${r} ${r} 0 ${a2 - a1 > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}
function el(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent?.appendChild(e);
  return e;
}
let gTitik, gAtas, gBawah, gAtasT, gBawahT;
function bangunGauge() {
  const svg = $("gauge");
  svg.innerHTML = "";
  el("path", { d: busur(135, 405), class: "g-trek" }, svg);
  ZONA.forEach((z) => {
    el("path", { d: busur(sudut(z.dari) + 0.8, sudut(z.sampai) - 0.8, GR), class: "g-zona", stroke: css(z.warna) }, svg);
  });
  [[G_MIN, "start"], [G_MAX, "end"]].forEach(([t, anchor]) => {
    const [x, y] = titik(sudut(t), GR);
    const tx = el("text", { x: x + (anchor === "start" ? 10 : -10), y: y + 16, class: "g-angka", "text-anchor": anchor }, svg);
    tx.textContent = `${t}°`;
  });
  gBawah = el("line", { class: "g-batas" }, svg);
  gAtas = el("line", { class: "g-batas" }, svg);
  gBawahT = el("text", { class: "g-batas-teks", "text-anchor": "middle", "dominant-baseline": "middle" }, svg);
  gAtasT = el("text", { class: "g-batas-teks", "text-anchor": "middle", "dominant-baseline": "middle" }, svg);
  gTitik = el("circle", { r: 9, cx: GC + GR, cy: GC, class: "g-titik", style: `transform-origin:${GC}px ${GC}px` }, svg);
  gTitik.style.transform = `rotate(${sudut(G_MIN)}deg)`;
}
function aturBatasGauge(garis, teks, t, label) {
  const a = sudut(t);
  const [x1, y1] = titik(a, GR + 9), [x2, y2] = titik(a, GR + 15);
  garis.setAttribute("x1", x1); garis.setAttribute("y1", y1);
  garis.setAttribute("x2", x2); garis.setAttribute("y2", y2);
  const [tx, ty] = titik(a, GR + 24);
  teks.setAttribute("x", tx); teks.setAttribute("y", ty);
  teks.textContent = label;
}

// ---------------------------------------------------------------
// Render
// ---------------------------------------------------------------
function render() {
  // Pembacaan
  const ada = state.suhu != null && !Number.isNaN(state.suhu);
  $("nilai-suhu").textContent = ada ? fmt(state.suhu) : "–";
  $("nilai-rh").textContent = state.kelembapan != null ? `${fmt(state.kelembapan, 0)}%` : "–";
  const z = ada ? zonaDari(state.suhu) : null;
  const elZona = $("zona");
  elZona.textContent = z ? z.nama : "Menunggu data";
  elZona.style.background = z ? `color-mix(in srgb, ${css(z.warna)} 22%, transparent)` : "";
  if (ada) gTitik.style.transform = `rotate(${sudut(state.suhu)}deg)`;
  gTitik.style.opacity = ada ? 1 : 0;
  aturBatasGauge(gAtas, gAtasT, state.batasAtas, "ON");
  aturBatasGauge(gBawah, gBawahT, state.batasBawah, "OFF");

  // Tombol power
  const acTampil = state.pending ? state.pending.ac : state.ac;
  const btn = $("btn-power");
  btn.setAttribute("aria-pressed", String(acTampil));
  btn.setAttribute("aria-label", acTampil ? "Matikan pendingin" : "Nyalakan pendingin");
  btn.classList.toggle("menunggu", Boolean(state.pending));
  $("power-judul").textContent = state.pending
    ? (state.pending.ac ? "Menyalakan pendingin…" : "Mematikan pendingin…")
    : (state.ac ? "Pendingin menyala" : "Pendingin mati");
  let sub;
  if (state.pending) sub = "Menunggu konfirmasi dari ESP32";
  else if (state.mode === "auto") sub = state.ac
    ? `Otomatis, mati saat temperatur turun di bawah ${fmt(state.batasBawah)} °C`
    : `Otomatis, menyala saat temperatur di atas ${fmt(state.batasAtas)} °C`;
  else sub = "Manual, ketuk tombol untuk menyalakan atau mematikan";
  $("power-sub").textContent = sub;

  // Mode
  document.querySelectorAll("[data-mode]").forEach((b) => {
    const aktif = b.dataset.mode === state.mode;
    b.classList.toggle("aktif", aktif);
    b.setAttribute("aria-checked", String(aktif));
  });
  $("mode-ket").textContent = state.mode === "auto"
    ? "ESP32 menyalakan dan mematikan pendingin sendiri berdasarkan batas temperatur. Mengetuk tombol power memindahkan ke mode Manual."
    : "Pendingin hanya mengikuti tombol power. Kembali ke Otomatis agar diatur temperatur.";

  // Slider
  if (!sedangGeser) {
    $("sl-atas").value = state.batasAtas;
    $("sl-bawah").value = state.batasBawah;
  }
  $("lbl-atas").textContent = `${fmt(Number($("sl-atas").value))} °C`;
  $("lbl-bawah").textContent = `${fmt(Number($("sl-bawah").value))} °C`;

  renderKoneksi();
}

function renderKoneksi() {
  const demo = state.sumber === "demo";
  const hp = demo || state.internetOn;
  const cloud = demo || (hp && state.firebaseOn);
  const esp = cloud && espOnline();
  const sensor = esp && state.sensorOk !== false && state.suhu != null;
  const acTampil = state.pending ? state.pending.ac : state.ac;

  const node = (n, st, ket) => {
    document.querySelector(`[data-node="${n}"]`).dataset.st = st;
    $(`ket-${n}`).textContent = ket;
  };
  node("hp", hp ? "ok" : "bad", hp ? "Online" : "Tanpa internet");
  node("cloud", !hp ? "" : cloud ? "ok" : "warn", !hp ? "–" : cloud ? (demo ? "Demo" : "Tersambung") : "Menyambung");
  node("esp", !cloud ? "" : esp ? "ok" : "bad", !cloud ? "–" : esp ? (state.rssi != null ? `${state.rssi} dBm` : "Online") : "Terputus");
  node("plant", !esp ? "" : !sensor ? "warn" : acTampil ? "dingin" : "ok",
    !esp ? "–" : !sensor ? "Sensor error" : acTampil ? "Peltier ON" : "Peltier OFF");
  const tali = (n, ok, putus) => { document.querySelector(`[data-link="${n}"]`).dataset.st = ok ? "ok" : putus ? "bad" : ""; };
  tali("hp", cloud, hp && !cloud);
  tali("cloud", esp, cloud && !esp);
  tali("esp", sensor, esp && !sensor);

  let status, teks, ket;
  if (demo) { status = "netral"; teks = "Mode demo"; ket = "Semua data dibuat aplikasi untuk mencoba tampilan."; }
  else if (!hp) { status = "bad"; teks = "Offline"; ket = "HP tidak terhubung ke internet. Nyalakan data seluler atau Wi-Fi."; }
  else if (!cloud) { status = "warn"; teks = "Menyambung"; ket = "Menyambung ke Firebase. Kalau lama, periksa koneksi internet HP."; }
  else if (!esp) {
    status = "bad"; teks = "ESP32 terputus";
    ket = waktuTerakhir()
      ? `ESP32 terakhir mengirim kabar ${sejak(waktuTerakhir())}. Periksa daya ESP32 dan hotspot Wi-Fi.`
      : "Belum ada kabar dari ESP32. Pastikan ESP32 menyala dan tersambung ke Wi-Fi.";
  } else if (!sensor) { status = "warn"; teks = "Sensor error"; ket = "ESP32 tersambung, tetapi DHT22 gagal dibaca. Periksa kabel DATA, VCC, dan GND."; }
  else { status = "ok"; teks = "Terhubung"; ket = "Aplikasi, Firebase, ESP32, dan sensor ruangan bekerja normal."; }
  const pill = $("pill-koneksi");
  pill.dataset.status = status;
  pill.querySelector("span").textContent = teks;
  $("koneksi-ket").textContent = ket;
  $("koneksi-waktu").textContent = demo ? "" : `data ${sejak(waktuTerakhir())}`;

  // Panel perangkat
  $("dv-status").textContent = demo ? "Demo" : esp ? "Terhubung" : "Terputus";
  $("dv-rssi").textContent = kualitasSinyal(state.rssi);
  $("dv-ip").textContent = state.ip || "–";
  $("dv-uptime").textContent = durasi(state.uptime);
  $("dv-sensor").textContent = state.sensorOk == null ? "–" : state.sensorOk ? "Terbaca" : "Gagal dibaca";
  $("dv-terakhir").textContent = sejak(waktuTerakhir());
}

// ---------------------------------------------------------------
// Grafik riwayat
// ---------------------------------------------------------------
let grafik;
function bangunGrafik() {
  grafik?.destroy();
  const ink = css("--muted"), garis = css("--line");
  grafik = new Chart($("grafik"), {
    type: "line",
    data: { labels: [], datasets: [
      { label: "Temperatur", data: [], borderColor: css("--ice"), backgroundColor: `color-mix(in srgb, ${css("--ice")} 14%, transparent)`, fill: true, tension: 0.3, pointRadius: 0, borderWidth: 2.2 },
      { label: "Batas ON", data: [], borderColor: css("--z-hot"), borderDash: [5, 4], pointRadius: 0, borderWidth: 1.4 },
      { label: "Batas OFF", data: [], borderColor: css("--z-ok"), borderDash: [5, 4], pointRadius: 0, borderWidth: 1.4 },
    ] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: { ticks: { color: ink, maxTicksLimit: 5, font: { family: "Sora", size: 10 } }, grid: { display: false } },
        y: { ticks: { color: ink, font: { family: "Sora", size: 10 }, callback: (v) => `${v}°` }, grid: { color: garis } },
      },
      plugins: {
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt(c.parsed.y)} °C` } },
      },
    },
  });
  perbaruiGrafik();
}
function perbaruiGrafik() {
  if (!grafik) return;
  $("grafik-kosong").hidden = riwayat.length > 0;
  grafik.data.labels = riwayat.map((r) => new Date(r.t).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }));
  grafik.data.datasets[0].data = riwayat.map((r) => r.suhu);
  grafik.data.datasets[1].data = riwayat.map(() => state.batasAtas);
  grafik.data.datasets[2].data = riwayat.map(() => state.batasBawah);
  grafik.update("none");
  const s = riwayat.map((r) => r.suhu).filter((v) => !Number.isNaN(v));
  $("st-min").textContent = s.length ? `${fmt(Math.min(...s))}°` : "–";
  $("st-max").textContent = s.length ? `${fmt(Math.max(...s))}°` : "–";
  $("st-avg").textContent = s.length ? `${fmt(s.reduce((a, b) => a + b, 0) / s.length)}°` : "–";
  const on = riwayat.filter((r) => r.ac).length;
  $("st-ac").textContent = riwayat.length ? `Pendingin menyala pada ${Math.round((on / riwayat.length) * 100)}% dari ${riwayat.length} titik data terakhir.` : "";
}

// ---------------------------------------------------------------
// Kontrol (tombol power, mode, batas)
// ---------------------------------------------------------------
let sedangGeser = false;
let timerPending;

function mulaiPending(ac) {
  state.pending = { ac, sejak: Date.now() };
  clearTimeout(timerPending);
  timerPending = setTimeout(() => {
    if (!state.pending) return;
    state.pending = null;
    render();
    toast("ESP32 belum merespons. Perintah tersimpan dan dijalankan saat ESP32 tersambung.");
  }, TUNGGU_ESP_MS);
}
function cekKonfirmasi() {
  if (state.pending && state.pending.ac === state.ac) {
    state.pending = null;
    clearTimeout(timerPending);
    toast(state.ac ? "Pendingin menyala" : "Pendingin mati");
  }
}

async function kirimAman(data, pesanSukses) {
  try {
    await kirim(data);
    if (pesanSukses) toast(pesanSukses);
  } catch (e) {
    state.pending = null;
    toast(e.code === "PERMISSION_DENIED" || /permission/i.test(e.message)
      ? "Firebase menolak perintah. Periksa aturan (rules) Realtime Database."
      : `Perintah gagal dikirim: ${e.message}`);
    render();
  }
}

function pasangKontrol() {
  $("btn-power").addEventListener("click", () => {
    getar();
    const acSekarang = state.pending ? state.pending.ac : state.ac;
    const target = !acSekarang;
    const pindahManual = state.mode === "auto";
    state.mode = "manual";
    state.acManual = target;
    mulaiPending(target);
    if (state.sumber === "demo") logikaDemo();
    render();
    kirimAman({ mode: "manual", ac_manual: target }, pindahManual ? "Pindah ke mode Manual" : null);
  });

  document.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => {
    const mode = b.dataset.mode;
    if (mode === state.mode) return;
    getar();
    state.mode = mode;
    state.evaluasiUlang = true;
    if (mode === "manual") state.acManual = state.ac;
    if (state.sumber === "demo") logikaDemo();
    render();
    kirimAman(mode === "manual" ? { mode, ac_manual: state.ac } : { mode },
      mode === "auto" ? "Mode Otomatis aktif" : "Mode Manual aktif");
  }));

  const terapkanBatas = (atas, bawah, pesan) => {
    atas = Math.round(atas * 2) / 2;
    bawah = Math.round(bawah * 2) / 2;
    if (atas - bawah < 1) {
      toast("Batas atas harus minimal 1 °C di atas batas bawah");
      render();
      return;
    }
    state.batasAtas = atas;
    state.batasBawah = bawah;
    state.evaluasiUlang = true;
    if (state.sumber === "demo") logikaDemo();
    render();
    perbaruiGrafik();
    kirimAman({ batas_atas: atas, batas_bawah: bawah }, pesan);
  };

  ["atas", "bawah"].forEach((k) => {
    const sl = $(`sl-${k}`);
    sl.addEventListener("input", () => { sedangGeser = true; render(); });
    sl.addEventListener("change", () => {
      sedangGeser = false;
      terapkanBatas(Number($("sl-atas").value), Number($("sl-bawah").value), "Batas temperatur disimpan");
    });
  });
  document.querySelectorAll(".langkah").forEach((b) => b.addEventListener("click", () => {
    const d = Number(b.dataset.d);
    const atas = state.batasAtas + (b.dataset.target === "atas" ? d : 0);
    const bawah = state.batasBawah + (b.dataset.target === "bawah" ? d : 0);
    if (atas > 40 || atas < 21 || bawah > 39 || bawah < 20) return;
    terapkanBatas(atas, bawah);
  }));
  $("btn-reset").addEventListener("click", () => terapkanBatas(27, 25, "Batas dikembalikan ke 27 °C dan 25 °C"));

  document.querySelectorAll(".tabbar button").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll(".tabbar button").forEach((x) => x.classList.toggle("aktif", x === b));
    ["kontrol", "riwayat", "atur"].forEach((t) => { $(`tab-${t}`).hidden = t !== b.dataset.tab; });
    if (b.dataset.tab === "riwayat") perbaruiGrafik();
    window.scrollTo({ top: 0 });
  }));
  $("pill-koneksi").addEventListener("click", () => {
    document.querySelector('.tabbar [data-tab="kontrol"]').click();
    document.getElementById("rantai").scrollIntoView({ behavior: "smooth", block: "center" });
  });

  window.addEventListener("online", () => { state.internetOn = true; renderKoneksi(); });
  window.addEventListener("offline", () => { state.internetOn = false; renderKoneksi(); });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { bangunGauge(); bangunGrafik(); render(); aturStatusBar(); });
  setInterval(renderKoneksi, 1000);
}

function terapkanKontrol(v) {
  state.mode = v.mode === "manual" ? "manual" : "auto";
  state.acManual = Boolean(v.ac_manual);
  if (v.batas_atas != null) state.batasAtas = Number(v.batas_atas);
  if (v.batas_bawah != null) state.batasBawah = Number(v.batas_bawah);
}

// ---------------------------------------------------------------
// Mode demo (meniru ESP32 dan ruangan, logika sama dengan ESP32)
// ---------------------------------------------------------------
function logikaDemo() {
  const sebelum = state.ac;
  if (state.mode === "auto") {
    if (state.evaluasiUlang) { state.ac = state.suhu > state.batasAtas; state.evaluasiUlang = false; }
    else if (state.suhu > state.batasAtas) state.ac = true;
    else if (state.suhu < state.batasBawah) state.ac = false;
  } else state.ac = state.acManual;
  if (state.pending) setTimeout(() => { cekKonfirmasi(); render(); }, 700);
  return sebelum !== state.ac;
}
function langkahDemo() {
  const target = state.ac ? 22 : 31;
  state.suhu += (target - state.suhu) * 0.05 + (Math.random() - 0.5) * 0.1;
  state.kelembapan += ((state.ac ? 58 : 75) - state.kelembapan) * 0.05 + (Math.random() - 0.5) * 0.6;
  state.lastSeen = state.heartbeat = Date.now();
  state.rssi = -54 + Math.round((Math.random() - 0.5) * 6);
  state.ip = "demo";
  state.uptime = (state.uptime || 0) + 2;
  state.sensorOk = true;
  logikaDemo();
  riwayat.push({ t: Date.now(), suhu: state.suhu, ac: state.ac });
  if (riwayat.length > RIWAYAT_MAX) riwayat.shift();
  render();
  if (!$("tab-riwayat").hidden) perbaruiGrafik();
}
let intervalDemo;
function mulaiDemo() {
  state.sumber = "demo";
  state.suhu = 28.6; state.kelembapan = 72;
  for (let i = RIWAYAT_MAX; i > 0; i--) {
    riwayat.push({ t: Date.now() - i * 30000, suhu: 30 - Math.sin(i / 9) * 1.6 + (Math.random() - 0.5) * 0.2, ac: Math.sin(i / 9) > 0.3 });
  }
  kirim = async () => {};
  $("panel-demo").hidden = false;
  $("akun-nama").textContent = "Pengguna demo";
  $("akun-email").textContent = "–";
  $("btn-keluar").textContent = "Keluar dari mode demo";
  tampilkanLayar("utama");
  langkahDemo();
  intervalDemo = setInterval(langkahDemo, 2000);
  perbaruiGrafik();
}
$("demo-panas").addEventListener("click", () => { state.suhu += 2; logikaDemo(); render(); });
$("demo-dingin").addEventListener("click", () => { state.suhu -= 2; logikaDemo(); render(); });

// ---------------------------------------------------------------
// Firebase
// ---------------------------------------------------------------
let db, berhenti = [];
const r = (p) => ref(db, `${ROOT_PATH}/${p}`);

function mulaiDengar() {
  hentikanDengar();
  state.sumber = "firebase";
  berhenti.push(onValue(ref(db, ".info/connected"), (s) => { state.firebaseOn = s.val() === true; renderKoneksi(); }));
  const gagal = (e) => toast(`Firebase menolak akses (${e.code || e.message}). Periksa rules Realtime Database.`);

  berhenti.push(onValue(r("sensor"), (s) => {
    const v = s.val(); if (!v) return;
    state.suhu = Number(v.suhu);
    state.kelembapan = Number(v.kelembapan);
    state.lastSeen = Number(v.timestamp) || Date.now();
    render();
  }, gagal));
  berhenti.push(onValue(r("status"), (s) => {
    const v = s.val(); if (!v) return;
    state.ac = Boolean(v.ac);
    state.heartbeat = Number(v.heartbeat) || 0;
    state.rssi = v.rssi ?? null;
    state.ip = v.ip || "";
    state.uptime = v.uptime ?? null;
    state.sensorOk = v.sensor_ok ?? null;
    cekKonfirmasi();
    render();
  }, gagal));
  berhenti.push(onValue(r("kontrol"), (s) => {
    const v = s.val();
    if (v) { terapkanKontrol(v); render(); perbaruiGrafik(); }
    else set(r("kontrol"), KONTROL_AWAL).catch(gagal);
  }, gagal));
  berhenti.push(onValue(query(r("riwayat"), limitToLast(RIWAYAT_MAX)), (s) => {
    riwayat.length = 0;
    s.forEach((c) => {
      const v = c.val();
      if (v && v.t) riwayat.push({ t: Number(v.t), suhu: Number(v.suhu), ac: Boolean(v.ac) });
    });
    perbaruiGrafik();
  }, gagal));
  kirim = (data) => update(r("kontrol"), data);
}
function hentikanDengar() {
  berhenti.forEach((f) => f());
  berhenti = [];
  kirim = async () => {};
}

const PESAN_AUTH = {
  "auth/invalid-email": "Format email belum benar.",
  "auth/missing-password": "Password wajib diisi.",
  "auth/invalid-credential": "Email atau password salah.",
  "auth/wrong-password": "Email atau password salah.",
  "auth/user-not-found": "Akun dengan email ini belum terdaftar.",
  "auth/email-already-in-use": "Email ini sudah terdaftar. Pilih Masuk.",
  "auth/weak-password": "Password minimal 6 karakter.",
  "auth/too-many-requests": "Terlalu banyak percobaan. Tunggu beberapa menit lalu coba lagi.",
  "auth/network-request-failed": "Tidak ada koneksi internet. Periksa data seluler atau Wi-Fi.",
  "auth/operation-not-allowed": "Login email/password belum diaktifkan di Firebase Authentication.",
};

let modeForm = "masuk";
function pesanAuth(teks, jenis) {
  const p = $("pesan-auth");
  p.textContent = teks;
  p.classList.toggle("sukses", jenis === "sukses");
}
function aturModeForm(m) {
  modeForm = m;
  const daftar = m === "daftar";
  $("tab-masuk").classList.toggle("aktif", !daftar);
  $("tab-daftar").classList.toggle("aktif", daftar);
  $("field-nama").hidden = !daftar;
  $("field-pass2").hidden = !daftar;
  $("btn-lupa").hidden = daftar;
  $("in-pass").autocomplete = daftar ? "new-password" : "current-password";
  $("btn-auth").textContent = daftar ? "Daftar" : "Masuk";
  pesanAuth("");
}

function pasangFormAuth() {
  $("tab-masuk").addEventListener("click", () => aturModeForm("masuk"));
  $("tab-daftar").addEventListener("click", () => aturModeForm("daftar"));
  $("btn-demo").addEventListener("click", mulaiDemo);

  $("form-auth").addEventListener("submit", async (e) => {
    e.preventDefault();
    const nama = $("in-nama").value.trim(), email = $("in-email").value.trim();
    const pass = $("in-pass").value, pass2 = $("in-pass2").value;
    const daftar = modeForm === "daftar";
    if (daftar && !nama) return pesanAuth("Nama wajib diisi.");
    if (!email) return pesanAuth("Email wajib diisi.");
    if (!pass) return pesanAuth("Password wajib diisi.");
    if (daftar && pass.length < 6) return pesanAuth("Password minimal 6 karakter.");
    if (daftar && pass !== pass2) return pesanAuth("Ulangi password belum sama.");
    if (!auth) return pesanAuth("Firebase belum termuat. Periksa koneksi internet lalu buka ulang aplikasi.");

    const tombol = $("btn-auth");
    tombol.disabled = true;
    tombol.textContent = daftar ? "Mendaftarkan…" : "Memeriksa…";
    try {
      if (daftar) {
        const cred = await createUserWithEmailAndPassword(auth, email, pass);
        await updateProfile(cred.user, { displayName: nama });
        await set(r(`pengguna/${cred.user.uid}`), { nama, email, dibuat: serverTimestamp() }).catch(() => {});
        $("akun-nama").textContent = nama;
      } else {
        await signInWithEmailAndPassword(auth, email, pass);
      }
      $("in-pass").value = ""; $("in-pass2").value = "";
    } catch (err) {
      pesanAuth(PESAN_AUTH[err.code] || `Gagal: ${err.message}`);
    } finally {
      tombol.disabled = false;
      tombol.textContent = daftar ? "Daftar" : "Masuk";
    }
  });

  $("btn-lupa").addEventListener("click", async () => {
    const email = $("in-email").value.trim();
    if (!email) return pesanAuth("Isi email dulu, lalu ketuk Lupa password lagi.");
    try {
      await sendPasswordResetEmail(auth, email);
      pesanAuth("Link ganti password sudah dikirim. Cek kotak masuk atau folder spam.", "sukses");
    } catch (err) { pesanAuth(PESAN_AUTH[err.code] || `Gagal: ${err.message}`); }
  });

  $("btn-keluar").addEventListener("click", async () => {
    if (state.sumber === "demo") { location.reload(); return; }
    await signOut(auth);
    toast("Anda sudah keluar");
  });
}

function hubungkanFirebase() {
  try {
    const app = initializeApp(firebaseConfig);
    db = getDatabase(app);
    auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
  } catch (e) {
    tampilkanLayar("masuk");
    pesanAuth(`Firebase tidak bisa dimuat: ${e.message}`);
    return;
  }
  const cadangan = setTimeout(() => { if (!$("layar-memuat").hidden) tampilkanLayar("masuk"); }, 6000);
  onAuthStateChanged(auth, (user) => {
    clearTimeout(cadangan);
    if (state.sumber === "demo") return;
    if (user && !user.isAnonymous) {
      $("akun-nama").textContent = user.displayName || user.email.split("@")[0];
      $("akun-email").textContent = user.email || "–";
      tampilkanLayar("utama");
      mulaiDengar();
      render();
    } else {
      hentikanDengar();
      state.sumber = null;
      aturModeForm(modeForm);
      tampilkanLayar("masuk");
    }
  });
}

function aturStatusBar() {
  if (!NATIVE) return;
  const gelap = window.matchMedia("(prefers-color-scheme: dark)").matches;
  StatusBar.setStyle({ style: gelap ? Style.Dark : Style.Light }).catch(() => {});
  if (Capacitor.getPlatform() === "android") {
    StatusBar.setBackgroundColor({ color: gelap ? "#0E1A21" : "#E9EFF2" }).catch(() => {});
  }
}

// ---------------------------------------------------------------
// Mulai
// ---------------------------------------------------------------
bangunGauge();
pasangKontrol();
pasangFormAuth();
bangunGrafik();
render();
aturStatusBar();

if (new URLSearchParams(location.search).has("demo")) mulaiDemo();
else hubungkanFirebase();

if (!NATIVE && "serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
