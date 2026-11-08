// ブルアカ生徒いえるかな？
// 入力された名前を正規化（ひらがな化）して生徒と照合する。
(() => {
  "use strict";

  const SCHOOL_COLORS = {
    Abydos: "#d39a2c", Gehenna: "#d6404f", Trinity: "#c7a03a", Millennium: "#2f7de1",
    Hyakkiyako: "#e0648c", Shanhaijing: "#23a37a", RedWinter: "#a8323b", Valkyrie: "#3a5ba0",
    SRT: "#4d5866", Arius: "#6b5b95", Highlander: "#2c8c99", WildHunt: "#8e44ad",
    Odyssey: "#1593b8", Collab: "#39c5bb",
  };
  const STORE = "ba-ierukana:";

  const { schools, students } = window.BA_DATA;
  const schoolByKey = Object.fromEntries(schools.map((s) => [s.key, s]));

  const $ = (id) => document.getElementById(id);
  const el = {
    modes: $("modes"), board: $("board"), found: $("found"), left: $("left"), timer: $("timer"),
    answer: $("answer"), startBtn: $("startBtn"), giveupBtn: $("giveupBtn"), lastHit: $("lastHit"),
    optSound: $("optSound"), optScroll: $("optScroll"), optHint: $("optHint"), best: $("best"),
    confirmDlg: $("confirmDlg"), confirmYes: $("confirmYes"), confirmNo: $("confirmNo"),
    resultDlg: $("resultDlg"), resultHead: $("resultHead"), resultTitle: $("resultTitle"),
    resultBody: $("resultBody"), shareX: $("shareX"), copyBtn: $("copyBtn"), closeResult: $("closeResult"),
  };

  // ---------- 文字列の正規化 ----------
  function normalize(str) {
    return str
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[\s・･=＝*＊.。、,]/g, "")
      .replace(/[-－‐―〜~]/g, "ー")
      .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  }

  // 回答文字列 → 生徒
  const answerMap = new Map();
  for (const s of students) {
    for (const a of s.answers) answerMap.set(normalize(a), s);
  }

  // ---------- 状態 ----------
  const state = {
    mode: "all",
    targets: [],          // 今回の出題対象
    found: new Set(),     // 正解した生徒 id
    playing: false,
    finished: false,
    startAt: 0,
    elapsed: 0,
    raf: 0,
  };
  const slotById = new Map();

  // ---------- 保存 ----------
  function load(key, def) {
    try {
      const v = localStorage.getItem(STORE + key);
      return v === null ? def : JSON.parse(v);
    } catch { return def; }
  }
  function save(key, value) {
    try { localStorage.setItem(STORE + key, JSON.stringify(value)); } catch { /* 保存できなくても続行 */ }
  }

  // ---------- 描画 ----------
  function renderModes() {
    const items = [{ key: "all", name: "全員", count: students.length }]
      .concat(schools.map((s) => ({ key: s.key, name: s.name, count: students.filter((p) => p.school === s.key).length })));
    el.modes.innerHTML = "";
    for (const m of items) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "mode" + (m.key === state.mode ? " active" : "");
      b.innerHTML = `<span>${m.name}<small>${m.count}</small></span>`;
      b.disabled = state.playing;
      b.addEventListener("click", () => { state.mode = m.key; save("mode", m.key); reset(); });
      el.modes.appendChild(b);
    }
  }

  function renderBoard() {
    el.board.innerHTML = "";
    slotById.clear();
    let no = 0;
    const keys = state.mode === "all" ? schools.map((s) => s.key) : [state.mode];
    for (const key of keys) {
      const list = state.targets.filter((p) => p.school === key);
      if (!list.length) continue;
      const sec = document.createElement("section");
      sec.className = "school";
      sec.style.setProperty("--c", SCHOOL_COLORS[key] || "#128afa");
      sec.innerHTML = `<div class="school-head"><span class="school-name"><span>${schoolByKey[key].long}</span></span>`
        + `<span class="school-count" data-school="${key}"></span></div><div class="slots"></div>`;
      const grid = sec.querySelector(".slots");
      for (const p of list) {
        no += 1;
        const slot = document.createElement("div");
        slot.className = "slot";
        slot.innerHTML = `<span class="slot-no">No.${String(no).padStart(3, "0")}</span>`
          + `<span class="slot-name">？？？</span><span class="slot-club">${p.club === "無し" ? "－" : p.club}</span>`;
        grid.appendChild(slot);
        slotById.set(p.id, slot);
      }
      el.board.appendChild(sec);
    }
    updateCounts();
  }

  function fillSlot(p, cls) {
    const slot = slotById.get(p.id);
    slot.classList.add(cls);
    slot.querySelector(".slot-name").textContent = p.name;
    if (p.family && p.family + p.personal !== p.name) slot.title = p.family + p.personal;
    return slot;
  }

  function updateCounts() {
    el.found.textContent = state.found.size;
    el.left.textContent = state.targets.length - state.found.size;
    for (const node of el.board.querySelectorAll(".school-count")) {
      const key = node.dataset.school;
      const total = state.targets.filter((p) => p.school === key).length;
      const got = state.targets.filter((p) => p.school === key && state.found.has(p.id)).length;
      node.textContent = `${got} / ${total}`;
    }
  }

  function updateBest() {
    const best = load("best:" + state.mode, null);
    el.best.textContent = best ? `自己ベスト ${formatTime(best)}` : "";
  }

  // ---------- タイマー ----------
  function formatTime(ms) {
    const cs = Math.floor(ms / 10) % 100;
    const s = Math.floor(ms / 1000) % 60;
    const m = Math.floor(ms / 60000) % 60;
    const h = Math.floor(ms / 3600000);
    const pad = (n) => String(n).padStart(2, "0");
    return (h ? `${h}:${pad(m)}` : pad(m)) + `:${pad(s)}.${pad(cs)}`;
  }
  function tick() {
    state.elapsed = performance.now() - state.startAt;
    el.timer.textContent = formatTime(state.elapsed);
    state.raf = requestAnimationFrame(tick);
  }
  function stopTimer() {
    cancelAnimationFrame(state.raf);
    state.elapsed = performance.now() - state.startAt;
    el.timer.textContent = formatTime(state.elapsed);
  }

  // ---------- 効果音 ----------
  let audio = null;
  function chime(ok) {
    if (!el.optSound.checked) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const notes = ok ? [880, 1318.5] : [220];
      notes.forEach((f, i) => {
        const o = audio.createOscillator();
        const g = audio.createGain();
        const t = audio.currentTime + i * 0.07;
        o.type = ok ? "triangle" : "square";
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(ok ? 0.18 : 0.05, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
        o.connect(g).connect(audio.destination);
        o.start(t);
        o.stop(t + 0.2);
      });
    } catch { /* 音が出せない環境は無視 */ }
  }

  // ---------- ゲーム進行 ----------
  function reset() {
    cancelAnimationFrame(state.raf);
    state.targets = state.mode === "all" ? students.slice() : students.filter((p) => p.school === state.mode);
    state.found.clear();
    state.playing = false;
    state.finished = false;
    state.elapsed = 0;
    el.timer.textContent = formatTime(0);
    el.answer.value = "";
    el.answer.disabled = true;
    el.answer.placeholder = "「開始」を押してね";
    el.startBtn.textContent = "開始";
    el.startBtn.disabled = false;
    el.giveupBtn.disabled = true;
    el.lastHit.textContent = "ひらがな・カタカナ・フルネーム（漢字）で入力できます";
    renderModes();
    renderBoard();
    updateBest();
  }

  function start() {
    if (state.finished) reset();
    state.playing = true;
    state.startAt = performance.now();
    el.answer.disabled = false;
    el.answer.placeholder = "生徒の名前を入力";
    el.answer.focus();
    el.startBtn.disabled = true;
    el.giveupBtn.disabled = false;
    el.lastHit.textContent = "スタート！";
    renderModes();
    tick();
  }

  function finish(cleared) {
    state.playing = false;
    state.finished = true;
    stopTimer();
    el.answer.disabled = true;
    el.answer.value = "";
    el.startBtn.textContent = "もう一度";
    el.startBtn.disabled = false;
    el.giveupBtn.disabled = true;
    renderModes();

    if (!cleared) {
      for (const p of state.targets) if (!state.found.has(p.id)) fillSlot(p, "miss");
    }
    let newBest = false;
    if (cleared) {
      const best = load("best:" + state.mode, null);
      if (best === null || state.elapsed < best) { save("best:" + state.mode, state.elapsed); newBest = true; }
      updateBest();
    }
    showResult(cleared, newBest);
  }

  function rankTitle(ratio) {
    if (ratio >= 1) return "キヴォトスの生徒を全員把握している先生";
    if (ratio >= 0.9) return "生徒想いのベテラン先生";
    if (ratio >= 0.6) return "頼れるシャーレの先生";
    if (ratio >= 0.3) return "当番の顔は覚えてきた先生";
    if (ratio > 0) return "着任したての新米先生";
    return "まずは推しの名前から……！";
  }

  function modeLabel() {
    return state.mode === "all" ? "全員" : schoolByKey[state.mode].name;
  }

  function showResult(cleared, newBest) {
    const total = state.targets.length;
    const got = state.found.size;
    const time = formatTime(state.elapsed);
    el.resultHead.textContent = cleared ? "MISSION COMPLETE" : "RESULT";
    el.resultTitle.textContent = cleared ? "クリアおめでとう！" : `${total}人中 ${got}人 言えたよ！`;
    el.resultBody.textContent = cleared
      ? `【${modeLabel()}】${total}人を ${time} で言えたよ！${newBest ? "\n自己ベスト更新！" : ""}\n称号：${rankTitle(1)}`
      : `【${modeLabel()}】タイム ${time}\n称号：${rankTitle(got / total)}`;

    const text = cleared
      ? `ブルアカ生徒いえるかな？【${modeLabel()}】${total}人を ${time} でクリア！\n称号：${rankTitle(1)}`
      : `ブルアカ生徒いえるかな？【${modeLabel()}】${total}人中 ${got}人 言えた！\n称号：${rankTitle(got / total)}`;
    const url = /^https?:/.test(location.href) ? location.href.split("#")[0] : "";
    const params = new URLSearchParams({ text, hashtags: "ブルアカいえるかな" });
    if (url) params.set("url", url);
    el.shareX.href = "https://twitter.com/intent/tweet?" + params.toString();
    el.copyBtn.dataset.text = text + "\n#ブルアカいえるかな" + (url ? "\n" + url : "");
    el.copyBtn.textContent = "結果をコピー";
    el.resultDlg.showModal();
  }

  // ---------- 入力判定 ----------
  function hit(p) {
    state.found.add(p.id);
    const slot = fillSlot(p, "hit");
    slot.classList.add("fresh");
    if (el.optScroll.checked) slot.scrollIntoView({ block: "center", behavior: "smooth" });
    el.lastHit.innerHTML = "";
    const b = document.createElement("b");
    b.textContent = p.name;
    el.lastHit.append(b, `（${schoolByKey[p.school].name}・${p.club === "無し" ? "所属なし" : p.club}）`);
    chime(true);
    updateCounts();
    if (state.found.size === state.targets.length) finish(true);
  }

  // 入力のたびに判定（入力途中で一致したら即正解）
  function check() {
    if (!state.playing) return;
    const p = answerMap.get(normalize(el.answer.value));
    if (!p || state.found.has(p.id) || !state.targets.includes(p)) return;
    el.answer.value = "";
    hit(p);
  }

  // Enter で確定したが正解にならなかったとき
  function reject() {
    const v = el.answer.value.trim();
    if (!state.playing || !v) return;
    const p = answerMap.get(normalize(v));
    if (p && state.found.has(p.id)) el.lastHit.textContent = `${p.name} はもう言ったよ`;
    else if (p) el.lastHit.textContent = `${p.name} は${schoolByKey[p.school].name}の生徒だよ`;
    else el.lastHit.textContent = `「${v}」はいないみたい……`;
    chime(false);
    el.answer.value = "";
    el.answer.classList.remove("shake");
    void el.answer.offsetWidth;
    el.answer.classList.add("shake");
  }

  // ---------- イベント ----------
  el.answer.addEventListener("input", (e) => { if (!e.isComposing) check(); });
  el.answer.addEventListener("compositionend", check);
  el.answer.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229) reject();
  });
  el.board.addEventListener("animationend", (e) => e.target.classList.remove("fresh"));

  el.startBtn.addEventListener("click", start);
  el.giveupBtn.addEventListener("click", () => el.confirmDlg.showModal());
  el.confirmYes.addEventListener("click", () => { el.confirmDlg.close(); finish(false); });
  el.confirmNo.addEventListener("click", () => { el.confirmDlg.close(); el.answer.focus(); });
  el.closeResult.addEventListener("click", () => el.resultDlg.close());
  el.copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(el.copyBtn.dataset.text);
      el.copyBtn.textContent = "コピーしました";
    } catch {
      el.copyBtn.textContent = "コピーできませんでした";
    }
  });

  for (const [key, input] of [["sound", el.optSound], ["scroll", el.optScroll], ["hint", el.optHint]]) {
    input.checked = load("opt:" + key, input.checked);
    input.addEventListener("change", () => {
      save("opt:" + key, input.checked);
      el.board.classList.toggle("hint-on", el.optHint.checked);
    });
  }
  el.board.classList.toggle("hint-on", el.optHint.checked);

  const savedMode = load("mode", "all");
  state.mode = savedMode === "all" || schoolByKey[savedMode] ? savedMode : "all";
  reset();
})();
