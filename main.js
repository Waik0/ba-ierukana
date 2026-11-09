// ブルアカ生徒いえるかな？
// 入力された名前を正規化（ひらがな化）して生徒と照合する。
// 名前だけで正解、名字まで入れたフルネームならゴールドになる。
(() => {
  "use strict";

  const SCHOOL_COLORS = {
    GSC: "#5a6f9e", Abydos: "#d39a2c", Gehenna: "#d6404f", Trinity: "#c7a03a", Millennium: "#2f7de1",
    Hyakkiyako: "#e0648c", Shanhaijing: "#23a37a", RedWinter: "#a8323b", Valkyrie: "#3a5ba0",
    SRT: "#4d5866", Arius: "#6b5b95", Highlander: "#2c8c99", WildHunt: "#8e44ad",
    Odyssey: "#1593b8", Chronos: "#e07b39", Other: "#7a7f8c", Decagrammaton: "#3fb8a8",
  };
  const LEVEL_LABEL = { normal: "ノーマル", hard: "むずかしい" };
  const STORE = "ba-ierukana:";

  const { schools, students } = window.BA_DATA;
  const schoolByKey = Object.fromEntries(schools.map((s) => [s.key, s]));

  const $ = (id) => document.getElementById(id);
  const el = {
    levels: $("levels"), modes: $("modes"), board: $("board"),
    found: $("found"), left: $("left"), fullCount: $("fullCount"), timer: $("timer"),
    answer: $("answer"), startBtn: $("startBtn"), giveupBtn: $("giveupBtn"), lastHit: $("lastHit"),
    optSound: $("optSound"), optScroll: $("optScroll"), optHint: $("optHint"), best: $("best"),
    confirmDlg: $("confirmDlg"), confirmYes: $("confirmYes"), confirmNo: $("confirmNo"),
    resultDlg: $("resultDlg"), resultHead: $("resultHead"), resultTitle: $("resultTitle"),
    resultBody: $("resultBody"), shareX: $("shareX"), copyBtn: $("copyBtn"), closeResult: $("closeResult"),
  };
  const introHTML = el.lastHit.innerHTML;

  // ---------- 文字列の正規化 ----------
  function normalize(str) {
    return str
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[\s・･=＝*＊.。、,]/g, "")
      .replace(/[-－‐―〜~]/g, "ー")
      .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  }

  // 回答文字列 → 生徒の配列（同じ読みの生徒がいても対応できるよう配列にする）
  function buildMap(field) {
    const map = new Map();
    for (const s of students) {
      for (const a of s[field]) {
        const key = normalize(a);
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(s);
      }
    }
    return map;
  }
  const nameMap = buildMap("answers");
  const fullMap = buildMap("fullAnswers");

  // ---------- 状態 ----------
  const state = {
    level: "normal",
    mode: "all",
    targets: [],          // 今回の出題対象
    targetIds: new Set(),
    found: new Set(),     // 名前を言えた生徒 id
    full: new Set(),      // フルネームまで言えた生徒 id
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

  // ---------- 出題対象 ----------
  function levelStudents() {
    return state.level === "hard" ? students : students.filter((p) => !p.npc);
  }
  function hasFamily(p) {
    return p.fullAnswers.length > 0;
  }
  function bestKey() {
    return `best:${state.level}:${state.mode}`;
  }

  // ---------- 描画 ----------
  function renderLevels() {
    for (const b of el.levels.querySelectorAll(".level")) {
      b.classList.toggle("active", b.dataset.level === state.level);
      b.disabled = state.playing;
    }
  }

  function renderModes() {
    const pool = levelStudents();
    const items = [{ key: "all", name: "全員", count: pool.length }];
    for (const s of schools) {
      const count = pool.filter((p) => p.school === s.key).length;
      if (count) items.push({ key: s.key, name: s.name, count });
    }
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
    for (const school of schools) {
      const list = state.targets.filter((p) => p.school === school.key);
      if (!list.length) continue;
      const sec = document.createElement("section");
      sec.className = "school";
      sec.style.setProperty("--c", SCHOOL_COLORS[school.key] || "#128afa");
      sec.innerHTML = `<div class="school-head"><span class="school-name"><span>${school.long}</span></span>`
        + `<span class="school-count" data-school="${school.key}"></span></div><div class="slots"></div>`;
      const grid = sec.querySelector(".slots");
      for (const p of list) {
        no += 1;
        const slot = document.createElement("div");
        slot.className = "slot";
        slot.innerHTML = `<span class="slot-no">No.${String(no).padStart(3, "0")}</span>`
          + `<span class="slot-name">？？？</span><span class="slot-club">${p.club === "無し" ? "－" : p.club}</span>`
          + (p.npc ? `<span class="slot-npc">NPC</span>` : "");
        grid.appendChild(slot);
        slotById.set(p.id, slot);
      }
      el.board.appendChild(sec);
    }
    updateCounts();
  }

  // スロットに名前を表示する。withFamily なら名字も出す
  function showName(p, withFamily, familyClass) {
    const nameEl = slotById.get(p.id).querySelector(".slot-name");
    nameEl.textContent = "";
    if (withFamily && p.family) {
      const fam = document.createElement("span");
      fam.className = "slot-family" + (familyClass ? " " + familyClass : "");
      fam.textContent = p.family;
      nameEl.append(fam);
    }
    nameEl.append(p.name);
  }

  function updateCounts() {
    el.found.textContent = state.found.size;
    el.left.textContent = state.targets.length - state.found.size;
    el.fullCount.textContent = state.full.size;
    for (const node of el.board.querySelectorAll(".school-count")) {
      const list = state.targets.filter((p) => p.school === node.dataset.school);
      const got = list.filter((p) => state.found.has(p.id)).length;
      const gold = list.filter((p) => state.full.has(p.id)).length;
      node.textContent = `${got} / ${list.length}` + (gold ? `（ゴールド ${gold}）` : "");
    }
  }

  function updateBest() {
    const best = load(bestKey(), null);
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
  // kind: "ok" 正解 / "gold" フルネーム / "ng" 不正解
  function chime(kind) {
    if (!el.optSound.checked) return;
    try {
      audio = audio || new AudioContext();
      const notes = { ok: [880, 1318.5], gold: [1046.5, 1318.5, 1568, 2093], ng: [220] }[kind];
      notes.forEach((f, i) => {
        const o = audio.createOscillator();
        const g = audio.createGain();
        const t = audio.currentTime + i * 0.07;
        o.type = kind === "ng" ? "square" : "triangle";
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(kind === "ng" ? 0.05 : 0.16, t + 0.01);
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
    const pool = levelStudents();
    if (state.mode !== "all" && !pool.some((p) => p.school === state.mode)) state.mode = "all";
    state.targets = state.mode === "all" ? pool.slice() : pool.filter((p) => p.school === state.mode);
    state.targetIds = new Set(state.targets.map((p) => p.id));
    state.found.clear();
    state.full.clear();
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
    el.lastHit.innerHTML = introHTML;
    renderLevels();
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
    renderLevels();
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
    renderLevels();
    renderModes();

    // 言えなかった生徒・名字を赤で表示
    for (const p of state.targets) {
      if (!state.found.has(p.id)) {
        slotById.get(p.id).classList.add("miss");
        showName(p, true);
      } else if (!state.full.has(p.id)) {
        showName(p, true, "missed");
      }
    }
    let newBest = false;
    if (cleared) {
      const best = load(bestKey(), null);
      if (best === null || state.elapsed < best) { save(bestKey(), state.elapsed); newBest = true; }
      updateBest();
    }
    showResult(cleared, newBest);
  }

  function rankTitle(ratio, perfect) {
    if (perfect) return "キヴォトスの生徒を名字まで覚えている先生";
    if (ratio >= 1) return "キヴォトスの生徒を全員把握している先生";
    if (ratio >= 0.9) return "生徒想いのベテラン先生";
    if (ratio >= 0.6) return "頼れるシャーレの先生";
    if (ratio >= 0.3) return "当番の顔は覚えてきた先生";
    if (ratio > 0) return "着任したての新米先生";
    return "まずは推しの名前から……！";
  }

  function modeLabel() {
    const range = state.mode === "all" ? "全員" : schoolByKey[state.mode].name;
    return `${LEVEL_LABEL[state.level]}・${range}`;
  }

  function showResult(cleared, newBest) {
    const total = state.targets.length;
    const got = state.found.size;
    const gold = state.full.size;
    const perfect = gold === total;
    const time = formatTime(state.elapsed);
    const title = rankTitle(got / total, perfect);
    const goldLine = `フルネーム ${gold} / ${total}人`;

    el.resultHead.textContent = perfect ? "PERFECT!" : cleared ? "MISSION COMPLETE" : "RESULT";
    el.resultTitle.textContent = perfect ? "フルネームで全員クリア！" : cleared ? "クリアおめでとう！" : `${total}人中 ${got}人 言えたよ！`;
    el.resultBody.textContent = (cleared
      ? `【${modeLabel()}】${total}人を ${time} で言えたよ！${newBest ? "\n自己ベスト更新！" : ""}`
      : `【${modeLabel()}】タイム ${time}`)
      + `\n${goldLine}\n称号：${title}`;

    const text = (cleared
      ? `ブルアカ生徒いえるかな？【${modeLabel()}】${total}人を ${time} でクリア！`
      : `ブルアカ生徒いえるかな？【${modeLabel()}】${total}人中 ${got}人 言えた！`)
      + `\n${goldLine}\n称号：${title}`;
    const url = /^https?:/.test(location.href) ? location.href.split("#")[0] : "";
    const params = new URLSearchParams({ text, hashtags: "ブルアカいえるかな" });
    if (url) params.set("url", url);
    el.shareX.href = "https://twitter.com/intent/tweet?" + params.toString();
    el.copyBtn.dataset.text = text + "\n#ブルアカいえるかな" + (url ? "\n" + url : "");
    el.copyBtn.textContent = "結果をコピー";
    el.resultDlg.showModal();
  }

  // ---------- 入力判定 ----------
  function announce(p, gold) {
    el.lastHit.innerHTML = "";
    const b = document.createElement("b");
    b.textContent = gold && p.family ? p.family + p.name : p.name;
    if (gold) b.className = "gold";
    const club = p.club === "無し" ? "所属なし" : p.club;
    el.lastHit.append(b, `（${schoolByKey[p.school].name}・${club}）`);
  }

  // 正解。gold ならフルネーム正解
  function accept(p, gold) {
    const slot = slotById.get(p.id);
    state.found.add(p.id);
    slot.classList.add("hit");
    // 名字のない生徒は名前だけでゴールド
    if (gold || !hasFamily(p)) {
      gold = true;
      state.full.add(p.id);
      slot.classList.add("gold");
    }
    showName(p, gold);
    slot.classList.remove("fresh");
    void slot.offsetWidth;
    slot.classList.add("fresh");
    if (el.optScroll.checked) slot.scrollIntoView({ block: "center", behavior: "smooth" });
    announce(p, gold);
    chime(gold ? "gold" : "ok");
    updateCounts();
    if (state.found.size === state.targets.length) finish(true);
  }

  function pick(map, value, done) {
    return (map.get(value) || []).find((p) => state.targetIds.has(p.id) && !done.has(p.id));
  }

  // 入力のたびに判定（入力途中で一致したら即正解）
  function check() {
    if (!state.playing) return;
    const v = normalize(el.answer.value);
    const fullHit = pick(fullMap, v, state.full);
    const nameHit = fullHit ? null : pick(nameMap, v, state.found);
    if (!fullHit && !nameHit) return;
    el.answer.value = "";
    accept(fullHit || nameHit, !!fullHit);
  }

  // Enter で確定したが正解にならなかったとき
  function reject() {
    const raw = el.answer.value.trim();
    if (!state.playing || !raw) return;
    const v = normalize(raw);
    const isFull = fullMap.has(v);
    const cands = (fullMap.get(v) || nameMap.get(v) || []);
    const p = cands.find((c) => state.targetIds.has(c.id)) || cands[0];
    let msg;
    if (!p) {
      msg = `「${raw}」はいないみたい……`;
    } else if (state.targetIds.has(p.id)) {
      msg = !isFull && hasFamily(p) && !state.full.has(p.id)
        ? `${p.name} はもう言ったよ（名字も入れるとゴールド！）`
        : `${p.name} はもう言ったよ`;
    } else if (p.npc && state.level === "normal") {
      msg = `${p.name} は未実装の生徒だよ（むずかしいで出題）`;
    } else {
      msg = `${p.name} は${schoolByKey[p.school].name}の生徒だよ`;
    }
    el.lastHit.textContent = msg;
    chime("ng");
    el.answer.value = "";
    el.answer.classList.remove("shake");
    void el.answer.offsetWidth;
    el.answer.classList.add("shake");
  }

  // ---------- イベント ----------
  el.answer.addEventListener("input", (e) => { if (!e.isComposing) check(); });
  el.answer.addEventListener("compositionend", check);
  el.answer.addEventListener("keydown", (e) => {
    // IME の変換確定の Enter は無視する（keyCode 229 は古いブラウザ向け）
    if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229) reject();
  });
  el.board.addEventListener("animationend", (e) => e.target.classList.remove("fresh"));

  for (const b of el.levels.querySelectorAll(".level")) {
    b.addEventListener("click", () => { state.level = b.dataset.level; save("level", state.level); reset(); });
  }
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

  state.level = load("level", "normal") === "hard" ? "hard" : "normal";
  const savedMode = load("mode", "all");
  state.mode = savedMode === "all" || schoolByKey[savedMode] ? savedMode : "all";
  reset();
})();
