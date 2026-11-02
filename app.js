/* 블로그 쇼츠 메이커 — 캔버스 렌더링 · 미리보기 · MediaRecorder 녹화 */
(function () {
  "use strict";
  const S = window.ShortsScript;
  const $ = (id) => document.getElementById(id);
  const W = 1080, H = 1920;
  const canvas = $("stage");
  const ctx = canvas.getContext("2d");

  const DISPLAY = '"Black Han Sans", "Noto Sans KR", sans-serif';
  const BODY = '"Noto Sans KR", sans-serif';

  const THEMES = {
    pop: { bg: ["#121212", "#2a2a2a", "#3a1530"], text: "#ffffff", accent: "#ffe14d", accentInk: "#111", pill: "#ff3b5c", pillInk: "#fff", stroke: "rgba(0,0,0,.85)", bar: "#ffe14d" },
    news: { bg: ["#0b1f4a", "#123a8c", "#0b1f4a"], text: "#ffffff", accent: "#ff2d2d", accentInk: "#fff", pill: "#ffffff", pillInk: "#0b1f4a", stroke: "rgba(0,0,0,.7)", bar: "#ff2d2d" },
    pastel: { bg: ["#ffe9e3", "#e7f0ff", "#f3e8ff"], text: "#1b1b2b", accent: "#6c4dff", accentInk: "#fff", pill: "#1b1b2b", pillInk: "#fff", stroke: "rgba(255,255,255,.95)", bar: "#6c4dff" },
  };

  const state = { script: null, scenes: [], hook: "", images: [], playing: false, t: 0, raf: 0, recording: false };

  // ---------- 글 불러오기 ----------
  async function loadPosts() {
    try {
      const res = await fetch("posts.json", { cache: "no-store" });
      if (!res.ok) return;
      const posts = await res.json();
      const sel = $("postPick");
      posts.forEach((p, i) => {
        const o = document.createElement("option");
        o.value = i;
        o.textContent = `${p.date} · ${p.title}`;
        sel.appendChild(o);
      });
      sel.addEventListener("change", () => {
        const p = posts[sel.value];
        if (!p) return;
        $("title").value = p.title;
        $("raw").value = p.md || htmlToText(p.html || "");
        if (!$("headline").value && p.district) $("headline").value = `${p.district} 새 소식`;
        generate();
      });
    } catch (_) { /* 로컬 파일로 열면 목록 없이 동작 */ }
  }

  /** 렌더된 HTML → 요약 구조가 살아 있는 텍스트(마크다운 비슷하게) */
  function htmlToText(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const out = [];
    const walk = (el) => {
      for (const n of el.children) {
        const tag = n.tagName;
        if (/^H[1-6]$/.test(tag)) out.push("\n" + "#".repeat(+tag[1]) + " " + n.textContent.trim() + "\n");
        else if (tag === "P") out.push(n.textContent.trim() + "\n");
        else if (tag === "UL" || tag === "OL") { n.querySelectorAll(":scope > li").forEach((li) => out.push("- " + li.textContent.replace(/\s+/g, " ").trim())); out.push(""); }
        else if (tag === "TABLE") { n.querySelectorAll("tr").forEach((tr) => out.push("| " + [...tr.children].map((c) => c.textContent.trim()).join(" | ") + " |")); out.push(""); }
        else if (tag === "BLOCKQUOTE" || tag === "DIV" || tag === "SECTION") walk(n);
      }
    };
    walk(doc.body);
    return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  // ---------- 대본 ----------
  function generate(keepHook) {
    const raw = $("raw").value.trim();
    if (!raw && !$("title").value.trim()) { status("본문을 먼저 넣어 주세요."); return; }
    const sc = S.buildScript(raw, { title: $("title").value.trim(), duration: +$("duration").value, hook: keepHook ? state.hook : undefined });
    state.script = sc;
    state.hook = sc.hook;
    state.scenes = sc.scenes.map((s) => ({ ...s }));
    if (!$("headline").value) {
      const d = S.detectDistrict(sc.title, sc.title);
      $("headline").value = d ? `${d} 새 소식` : "";
    }
    renderHooks();
    renderScenes();
    renderOutputs();
    $("scriptCard").hidden = false;
    $("outCard").hidden = false;
    seek(0.8);
    status("대본이 준비됐어요. 미리보기로 확인하고 내려받으세요.");
  }

  function renderHooks() {
    const box = $("hooks");
    box.innerHTML = "";
    state.script.hooks.forEach((h, i) => {
      const id = "hook" + i;
      const lab = document.createElement("label");
      lab.innerHTML = `<input type="radio" name="hook" id="${id}"> <span></span>`;
      lab.querySelector("span").textContent = h;
      const r = lab.querySelector("input");
      r.checked = h === state.hook;
      r.addEventListener("change", () => { setHook(h); });
      box.appendChild(lab);
    });
  }

  function setHook(h) {
    state.hook = h;
    const hookScene = state.scenes.find((s) => s.kind === "hook");
    if (hookScene) hookScene.text = h;
    renderScenes();
    renderOutputs();
    seek(0.8);
  }

  function renderScenes() {
    const box = $("scenes");
    box.innerHTML = "";
    state.scenes.forEach((s, i) => {
      const row = document.createElement("div");
      row.className = "scene";
      const tag = s.kind === "hook" ? "훅" : s.kind === "cta" ? "마무리" : `포인트 ${state.scenes.slice(0, i).filter((x) => x.kind === "point").length + 1}`;
      row.innerHTML = `<div class="tag"></div><textarea rows="2"></textarea><div><input type="number" min="1" max="20" step="0.5" aria-label="초"><div class="hint" style="text-align:center;margin:2px 0 0">초</div></div>`;
      row.querySelector(".tag").textContent = tag;
      const ta = row.querySelector("textarea");
      ta.value = s.text;
      ta.addEventListener("input", () => { s.text = ta.value; if (s.kind === "hook") state.hook = ta.value; renderOutputs(); seek(sceneStart(i) + Math.min(1, s.dur / 2)); });
      const num = row.querySelector("input");
      num.value = s.dur;
      num.addEventListener("input", () => { s.dur = Math.max(1, +num.value || 1); updateTotal(); });
      if (s.kind === "point") {
        const del = document.createElement("button");
        del.textContent = "삭제";
        del.style.cssText = "margin-top:6px;padding:4px 8px;font-size:12px;width:100%";
        del.addEventListener("click", () => { state.scenes.splice(i, 1); renderScenes(); renderOutputs(); });
        row.children[2].appendChild(del);
      }
      box.appendChild(row);
    });
    updateTotal();
  }

  function updateTotal() {
    const t = totalDur();
    const el = $("total");
    el.textContent = `${t.toFixed(1)}초`;
    el.classList.toggle("warn", t > 60);
    $("seek").max = t;
  }

  function renderOutputs() {
    const points = state.scenes.filter((s) => s.kind === "point").map((s) => "✔ " + s.text.replace(/\s*\|\s*/, ": ").replace(/\n/g, " "));
    $("caption").value = `${state.hook}\n\n${points.join("\n")}\n\n자세한 내용은 프로필 링크에서 확인하세요.\n\n${state.script.hashtags.join(" ")}`;
    $("narration").value = state.scenes.map((s) => s.text.replace(/\n/g, " ").replace(/\s*\|\s*/g, ", ")).join("\n");
  }

  const totalDur = () => state.scenes.reduce((a, s) => a + (+s.dur || 0), 0);
  const sceneStart = (i) => state.scenes.slice(0, i).reduce((a, s) => a + s.dur, 0);

  // ---------- 그리기 ----------
  const ease = {
    outBack: (x) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); },
    outCubic: (x) => 1 - Math.pow(1 - x, 3),
  };
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function wrapByWidth(text, maxW) {
    const lines = [];
    for (const para of String(text).split("\n")) {
      let line = "";
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const test = line ? line + " " + word : word;
        if (ctx.measureText(test).width <= maxW || !line) line = test;
        else { lines.push(line); line = word; }
        // 띄어쓰기 없는 긴 단어는 글자 단위로 끊기
        while (ctx.measureText(line).width > maxW && line.length > 1) {
          let k = line.length - 1;
          while (k > 1 && ctx.measureText(line.slice(0, k)).width > maxW) k--;
          lines.push(line.slice(0, k));
          line = line.slice(k);
        }
      }
      if (line) lines.push(line);
    }
    return lines;
  }

  /** 글자 크기를 줄여 가며 maxLines 안에 맞춘다 */
  function fitText(text, font, start, min, maxW, maxLines) {
    let size = start;
    let lines;
    for (; size >= min; size -= 4) {
      ctx.font = `${size}px ${font}`;
      lines = wrapByWidth(text, maxW);
      if (lines.length <= maxLines) break;
    }
    size = Math.max(size, min);
    ctx.font = `${size}px ${font}`;
    return { size, lines: wrapByWidth(text, maxW) };
  }

  /** 숫자 구간은 형광펜 강조 */
  function drawRichLine(line, cx, y, size, th, alpha) {
    const spans = S.numberSpans(line);
    const segs = [];
    let at = 0;
    for (const [a, b] of spans) {
      if (a > at) segs.push({ t: line.slice(at, a), hi: false });
      segs.push({ t: line.slice(a, b), hi: true });
      at = b;
    }
    if (at < line.length) segs.push({ t: line.slice(at), hi: false });
    const total = ctx.measureText(line).width;
    let x = cx - total / 2;
    ctx.globalAlpha = alpha;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    for (const s of segs) {
      const w = ctx.measureText(s.t).width;
      if (s.hi) {
        ctx.fillStyle = th.accent;
        roundRect(x - 10, y - size * 0.58, w + 20, size * 1.16, 14);
        ctx.fill();
        ctx.fillStyle = th.accentInk;
        ctx.fillText(s.t, x, y + size * 0.04);
      } else {
        ctx.lineJoin = "round";
        ctx.lineWidth = size * 0.16;
        ctx.strokeStyle = th.stroke;
        ctx.strokeText(s.t, x, y + size * 0.04);
        ctx.fillStyle = th.text;
        ctx.fillText(s.t, x, y + size * 0.04);
      }
      x += w;
    }
    ctx.globalAlpha = 1;
  }

  function drawBackground(t, idx, lt, sceneDur, th) {
    const img = state.images.length ? state.images[idx % state.images.length] : null;
    if (img) {
      // 켄 번즈: 장면마다 천천히 확대
      const z = 1.05 + 0.1 * (lt / sceneDur);
      const scale = Math.max(W / img.width, H / img.height) * z;
      const w = img.width * scale, h = img.height * scale;
      const dx = (idx % 2 ? -1 : 1) * 30 * (lt / sceneDur);
      ctx.drawImage(img, (W - w) / 2 + dx, (H - h) / 2, w, h);
      ctx.fillStyle = "rgba(0,0,0,.42)";
      ctx.fillRect(0, 0, W, H);
      return;
    }
    const a = t * 0.25;
    const g = ctx.createLinearGradient(W / 2 + Math.cos(a) * W, H / 2 + Math.sin(a) * H, W / 2 - Math.cos(a) * W, H / 2 - Math.sin(a) * H);
    g.addColorStop(0, th.bg[0]);
    g.addColorStop(0.55, th.bg[1]);
    g.addColorStop(1, th.bg[2]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // 떠다니는 원
    for (let i = 0; i < 6; i++) {
      const r = 140 + 70 * ((i * 37) % 5);
      const x = ((i * 271 + t * (18 + i * 6)) % (W + 2 * r)) - r;
      const y = (i * 389) % H + Math.sin(t * 0.8 + i) * 60;
      ctx.globalAlpha = 0.07;
      ctx.fillStyle = i % 2 ? th.accent : th.text;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function sceneAt(t) {
    let acc = 0;
    for (let i = 0; i < state.scenes.length; i++) {
      const d = state.scenes[i].dur;
      if (t < acc + d || i === state.scenes.length - 1) return { i, s: state.scenes[i], lt: Math.max(0, t - acc), d };
      acc += d;
    }
    return null;
  }

  function draw(t) {
    const th = THEMES[$("theme").value] || THEMES.pop;
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    if (!state.scenes.length) {
      drawBackground(t, 0, 0, 1, th);
      ctx.font = `90px ${DISPLAY}`;
      drawRichLine("블로그 글을", W / 2, H / 2 - 70, 90, th, 1);
      drawRichLine("30초 쇼츠로", W / 2, H / 2 + 60, 90, th, 1);
      ctx.restore();
      return;
    }
    const cur = sceneAt(t);
    const { i, s, lt, d } = cur;

    // 훅 장면은 살짝 줌 펀치
    const punch = s.kind === "hook" ? 1 + 0.04 * Math.sin(Math.min(lt, 0.3) / 0.3 * Math.PI) : 1;
    ctx.translate(W / 2, H / 2);
    ctx.scale(punch, punch);
    ctx.translate(-W / 2, -H / 2);
    drawBackground(t, i, lt, d, th);
    ctx.restore();
    ctx.save();

    // 진행 바
    if ($("progress").checked) {
      ctx.fillStyle = "rgba(255,255,255,.25)";
      ctx.fillRect(0, 0, W, 14);
      ctx.fillStyle = th.bar;
      ctx.fillRect(0, 0, W * clamp(t / totalDur()), 14);
    }

    // 상단 고정 제목 (Shorts UI와 겹치지 않는 위쪽 영역)
    const head = $("headline").value.trim();
    if (head) {
      ctx.font = `76px ${DISPLAY}`;
      const fit = fitText(head, DISPLAY, 76, 52, W - 160, 2);
      const lh = fit.size * 1.18;
      const boxH = lh * fit.lines.length + 50;
      const y0 = 190;
      ctx.fillStyle = th.pill;
      ctx.globalAlpha = 0.95;
      roundRect(60, y0, W - 120, boxH, 26);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = th.pillInk;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      fit.lines.forEach((ln, k) => ctx.fillText(ln, W / 2, y0 + 25 + lh * (k + 0.5)));
    }

    // 본문 텍스트
    let label = "";
    let body = s.text;
    const pipe = body.match(/^(.{1,14}?)\s*\|\s*([\s\S]+)$/);
    if (pipe) { label = pipe[1]; body = pipe[2]; }
    else if (s.kind === "point") label = s.label || "";

    const isHook = s.kind === "hook";
    const isCta = s.kind === "cta";
    const start = isHook ? 124 : 104;
    const fit = fitText(body, DISPLAY, start, 64, W - 150, isHook ? 4 : 5);
    const lh = fit.size * 1.32;
    const blockH = lh * fit.lines.length + (label ? 130 : 0);
    let y = H * 0.5 - blockH / 2 + (head ? 60 : 0);
    const inT = clamp(lt / 0.35);
    const outT = clamp((d - lt) / 0.2);

    if (label) {
      ctx.font = `700 52px ${BODY}`;
      const lw = ctx.measureText(label).width + 64;
      const ls = ease.outBack(clamp(lt / 0.3));
      ctx.save();
      ctx.translate(W / 2, y + 40);
      ctx.scale(ls, ls);
      ctx.globalAlpha = outT;
      ctx.fillStyle = th.pill;
      roundRect(-lw / 2, -42, lw, 84, 42);
      ctx.fill();
      ctx.fillStyle = th.pillInk;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, 0, 2);
      ctx.restore();
      y += 130;
    }

    fit.lines.forEach((ln, k) => {
      const lt2 = clamp((lt - 0.08 - k * 0.12) / 0.35);
      const sc = 0.82 + 0.18 * ease.outBack(lt2);
      const cy = y + lh * (k + 0.5);
      ctx.save();
      ctx.translate(W / 2, cy + (1 - ease.outCubic(lt2)) * 40);
      ctx.scale(sc, sc);
      ctx.font = `${fit.size}px ${DISPLAY}`;
      drawRichLine(ln, 0, 0, fit.size, th, Math.min(lt2 * 1.5, outT));
      ctx.restore();
    });

    // 마무리: 채널 이름 + 깜빡이는 화살표
    if (isCta) {
      const handle = $("handle").value.trim();
      const by = y + lh * fit.lines.length + 90;
      if (handle) {
        ctx.font = `700 54px ${BODY}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = th.text;
        ctx.globalAlpha = clamp((lt - 0.4) / 0.3);
        ctx.fillText(handle, W / 2, by);
      }
      ctx.globalAlpha = 0.6 + 0.4 * Math.sin(lt * 8);
      // 아래쪽 화살표(쉐브론)
      const ay = by + 120 + Math.sin(lt * 6) * 14;
      ctx.strokeStyle = th.accent;
      ctx.lineWidth = 22;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(W / 2 - 60, ay - 30);
      ctx.lineTo(W / 2, ay + 30);
      ctx.lineTo(W / 2 + 60, ay - 30);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // 장면 시작 플래시
    if (lt < 0.12 && i > 0) {
      ctx.fillStyle = `rgba(255,255,255,${0.35 * (1 - lt / 0.12)})`;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  }

  // ---------- 오디오 ----------
  let actx = null, master = null, recDest = null, bgmEl = null, bgmGain = null;
  function audio() {
    if (actx) return actx;
    actx = new (window.AudioContext || window.webkitAudioContext)();
    master = actx.createGain();
    master.connect(actx.destination);
    recDest = actx.createMediaStreamDestination();
    master.connect(recDest);
    bgmGain = actx.createGain();
    bgmGain.connect(master);
    return actx;
  }

  function blip(kind) {
    if (!$("sfx").checked || !actx) return;
    const now = actx.currentTime;
    const o = actx.createOscillator();
    const g = actx.createGain();
    if (kind === "hook") { o.type = "sawtooth"; o.frequency.setValueAtTime(180, now); o.frequency.exponentialRampToValueAtTime(60, now + 0.25); }
    else { o.type = "sine"; o.frequency.setValueAtTime(900, now); o.frequency.exponentialRampToValueAtTime(1500, now + 0.08); }
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(kind === "hook" ? 0.35 : 0.22, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + (kind === "hook" ? 0.3 : 0.14));
    o.connect(g).connect(master);
    o.start(now);
    o.stop(now + 0.35);
  }

  function startBgm(fromT) {
    if (!bgmEl) return;
    bgmGain.gain.cancelScheduledValues(actx.currentTime);
    bgmGain.gain.setValueAtTime(+$("bgmVol").value, actx.currentTime);
    bgmEl.currentTime = fromT % (bgmEl.duration || 1e9);
    bgmEl.play().catch(() => {});
  }
  function stopBgm() { if (bgmEl) bgmEl.pause(); }

  function speakScene(s) {
    if (!$("tts").checked || state.recording || !("speechSynthesis" in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(s.text.replace(/\s*\|\s*/g, ", ").replace(/\n/g, " "));
    u.lang = "ko-KR";
    u.rate = 1.15;
    speechSynthesis.speak(u);
  }

  // ---------- 재생 ----------
  function seek(t) {
    state.t = clamp(t, 0, totalDur() || 0);
    $("seek").value = state.t;
    draw(state.t);
  }

  function play({ onEnd } = {}) {
    if (!state.scenes.length) { status("먼저 대본을 만들어 주세요."); return; }
    audio();
    actx.resume();
    state.playing = true;
    $("play").textContent = "■ 정지";
    let from = state.t >= totalDur() - 0.05 ? 0 : state.t;
    if (state.recording) from = 0;
    const t0 = performance.now() - from * 1000;
    let lastIdx = -1;
    startBgm(from);
    const total = totalDur();
    const fadeAt = total - 1;
    let faded = false;
    const tick = () => {
      if (!state.playing) return;
      const t = (performance.now() - t0) / 1000;
      if (t >= total) {
        draw(total - 0.001);
        stop();
        if (onEnd) onEnd();
        return;
      }
      const cur = sceneAt(t);
      if (cur.i !== lastIdx) { lastIdx = cur.i; blip(cur.s.kind); speakScene(cur.s); }
      if (bgmEl && !faded && t >= fadeAt) { faded = true; bgmGain.gain.linearRampToValueAtTime(0, actx.currentTime + 0.9); }
      state.t = t;
      $("seek").value = t;
      draw(t);
      if (state.recording) status(`녹화 중… ${Math.ceil(total - t)}초 남음`);
      state.raf = requestAnimationFrame(tick);
    };
    tick();
  }

  function stop() {
    state.playing = false;
    cancelAnimationFrame(state.raf);
    stopBgm();
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    $("play").textContent = "▶ 미리보기";
  }

  // ---------- 녹화 ----------
  function pickMime() {
    const list = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4;codecs=avc1,opus", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
    return list.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || "";
  }

  async function record() {
    if (!state.scenes.length) { status("먼저 대본을 만들어 주세요."); return; }
    if (!window.MediaRecorder || !canvas.captureStream) { status("이 브라우저는 영상 녹화를 지원하지 않아요. PC 크롬을 써 주세요."); return; }
    stop();
    audio();
    await actx.resume();
    const mime = pickMime();
    const stream = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...recDest.stream.getAudioTracks()]);
    const rec = new MediaRecorder(stream, { mimeType: mime || undefined, videoBitsPerSecond: 8_000_000 });
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      state.recording = false;
      setBusy(false);
      const type = rec.mimeType || mime || "video/webm";
      const ext = type.includes("mp4") ? "mp4" : "webm";
      const blob = new Blob(chunks, { type });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${fileBase()}.${ext}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
      status(`완료! ${a.download} (${(blob.size / 1048576).toFixed(1)}MB)` + (ext === "webm" ? " — 업로드 앱이 WebM을 받지 않으면 MP4로 변환해 주세요." : ""));
    };
    state.recording = true;
    setBusy(true);
    state.t = 0;
    draw(0);
    rec.start(250);
    play({ onEnd: () => setTimeout(() => rec.state !== "inactive" && rec.stop(), 150) });
  }

  function fileBase() {
    const base = (state.script && state.script.title) || "shorts";
    return "shorts-" + base.replace(/[\\/:*?"<>|\s]+/g, "-").slice(0, 40);
  }

  function setBusy(b) {
    ["rec", "play", "gen", "thumb"].forEach((id) => ($(id).disabled = b));
    $("seek").disabled = b;
  }

  function status(msg) { $("status").textContent = msg; }


  // ---------- 이미지 불러오기 ----------
  /** 주소 목록 → 불러온 Image 목록 (실패·작은 그림 제외). 외부 그림은 crossOrigin 으로 받아야 녹화가 된다 */
  function loadImages(srcs, { cors = false, minW = 0, timeout = 15000 } = {}) {
    return Promise.all(
      srcs.map((src) => new Promise((res) => {
        const im = new Image();
        if (cors) im.crossOrigin = "anonymous";
        const t = setTimeout(() => res(null), timeout);
        im.onload = () => { clearTimeout(t); res(im.naturalWidth >= minW ? im : null); };
        im.onerror = () => { clearTimeout(t); res(null); };
        im.src = src;
      }))
    ).then((a) => a.filter(Boolean));
  }

  // ---------- 블로그 주소로 불러오기 ----------
  // 브라우저는 다른 사이트를 직접 읽을 수 없어(CORS) 공개 리더(r.jina.ai)와 이미지 프록시(images.weserv.nl)를 거친다
  const READER = "https://r.jina.ai/";
  const IMG_PROXY = (u) => "https://images.weserv.nl/?url=" + encodeURIComponent(u) + "&w=1080&output=jpg&q=85";
  const SKIP_IMG = /sticker|emoji|emoticon|profile|favicon|logo|icon|blank|spacer|btn_|ico_|\.svg|\.gif(\?|$)/i;

  function normalizeBlogUrl(url) {
    try {
      const u = new URL(url.trim());
      if (/(^|\.)blog\.naver\.com$/.test(u.hostname)) {
        const id = u.searchParams.get("blogId"), no = u.searchParams.get("logNo");
        if (id && no) return `https://m.blog.naver.com/${id}/${no}`;
        const parts = u.pathname.split("/").filter(Boolean);
        if (parts.length >= 2 && /^\d+$/.test(parts[1])) return `https://m.blog.naver.com/${parts[0]}/${parts[1]}`;
      }
      return u.href;
    } catch (_) { return ""; }
  }

  function fixImg(src) {
    if (/pstatic\.net/.test(src)) {
      src = src.replace("postfiles.pstatic.net", "mblogthumb-phinf.pstatic.net").replace(/\?type=\w+/, "") + "?type=w966";
    }
    return src;
  }

  async function importFromUrl() {
    const url = normalizeBlogUrl($("blogUrl").value);
    if (!url) { status("블로그 주소를 정확히 넣어 주세요. (https:// 로 시작)"); return; }
    $("importBtn").disabled = true;
    status("블로그 글을 읽는 중… (10초 정도 걸릴 수 있어요)");
    try {
      const res = await fetch(READER + url);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const txt = await res.text();
      const title = ((txt.match(/^Title:\s*(.+)$/m) || [])[1] || "").replace(/\s*[:|-]\s*네이버 블로그$/, "").trim();
      const body = txt.split(/^Markdown Content:\s*$/m)[1] || txt;
      const imgs = [...body.matchAll(/!\[[^\]]*\]\((https?:[^)\s]+)/g)].map((m) => fixImg(m[1])).filter((u) => !SKIP_IMG.test(u));
      const text = body
        .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, "")
        .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
        .replace(/^\s*\[[^\]]*\]\([^)]*\)\s*$/gm, "") // 링크만 있는 줄(메뉴 등)
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      if (text.length < 50) throw new Error("본문이 너무 짧음");
      $("title").value = title;
      $("raw").value = text;
      $("headline").value = "";
      status(`글을 읽었어요. 그림 ${Math.min(imgs.length, 8)}장 불러오는 중…`);
      const uniq = [...new Set(imgs)].slice(0, 8);
      state.images = await loadImages(uniq.map(IMG_PROXY), { cors: true, minW: 300 });
      state.sourceUrl = $("blogUrl").value.trim();
      generate();
      status(state.images.length
        ? `완료! 블로그 그림 ${state.images.length}장을 장면 배경으로 썼어요.`
        : "글은 불러왔지만 그림을 가져오지 못해 기본 배경을 써요. 「배경 사진」으로 직접 올릴 수도 있어요.");
    } catch (e) {
      status("이 주소는 브라우저에서 읽지 못했어요. 아래 「음성 포함 자동 생성」을 쓰거나 본문을 복사해 붙여 넣어 주세요.");
    } finally {
      $("importBtn").disabled = false;
    }
  }

  $("importBtn").addEventListener("click", importFromUrl);
  $("blogUrl").addEventListener("keydown", (e) => e.key === "Enter" && importFromUrl());
  $("autoReq").addEventListener("click", async () => {
    const url = $("blogUrl").value.trim();
    if (!/^https?:\/\//.test(url)) { status("먼저 블로그 주소를 넣어 주세요."); return; }
    try { await navigator.clipboard.writeText(url); } catch (_) {}
    window.open("https://github.com/yumestory1222-pixel/blog_short/actions/workflows/shorts.yml", "_blank", "noopener");
    status("주소를 복사했어요. 열린 GitHub 화면에서 「Run workflow」 → 「블로그 주소」 칸에 붙여 넣고 실행하면 3~5분 뒤 위 목록에 음성 포함 영상이 올라와요.");
  });

  // ---------- 이벤트 ----------
  $("gen").addEventListener("click", () => generate());
  $("duration").addEventListener("change", () => state.script && generate(true));
  ["theme", "headline", "handle", "progress"].forEach((id) => $(id).addEventListener("input", () => !state.playing && draw(state.t)));
  $("seek").addEventListener("input", (e) => { if (!state.recording) { stop(); seek(+e.target.value); } });
  $("play").addEventListener("click", () => (state.playing ? stop() : play()));
  $("rec").addEventListener("click", record);
  $("addScene").addEventListener("click", () => {
    const at = state.scenes.findIndex((s) => s.kind === "cta");
    state.scenes.splice(at < 0 ? state.scenes.length : at, 0, { kind: "point", label: "", text: "새 포인트", dur: 4 });
    renderScenes();
  });
  $("thumb").addEventListener("click", () => {
    stop();
    draw(Math.min(1.2, totalDur()));
    canvas.toBlob((b) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b);
      a.download = fileBase() + "-thumb.png";
      a.click();
    }, "image/png");
  });
  document.querySelectorAll("[data-copy]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const ta = $(btn.dataset.copy);
      try { await navigator.clipboard.writeText(ta.value); } catch (_) { ta.select(); document.execCommand("copy"); }
      const old = btn.textContent;
      btn.textContent = "복사됨";
      setTimeout(() => (btn.textContent = old), 1200);
    })
  );
  $("bgImgs").addEventListener("change", async (e) => {
    state.images = await loadImages([...e.target.files].map((f) => URL.createObjectURL(f)));
    draw(state.t);
  });
  $("bgm").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (!f) return;
    audio();
    if (!bgmEl) {
      bgmEl = new Audio();
      bgmEl.loop = true;
      actx.createMediaElementSource(bgmEl).connect(bgmGain);
    }
    bgmEl.src = URL.createObjectURL(f);
    status(`배경 음악: ${f.name}`);
  });
  $("bgmVol").addEventListener("input", (e) => bgmGain && bgmGain.gain.setValueAtTime(+e.target.value, actx.currentTime));

  // 글꼴이 준비된 뒤 첫 화면
  const fontsReady = Promise.all([document.fonts.load(`100px "Black Han Sans"`), document.fonts.load(`700 50px "Noto Sans KR"`)])
    .catch(() => {})
    .then(() => { draw(0); state.scenes.length && draw(state.t); });

  // 자동 영상 생성(tools/make_video.py)용: 대본을 넣고 프레임 단위로 그린다
  window.ShortsApp = {
    ready: () => fontsReady.then(() => document.fonts.ready),
    async load(script, opts = {}) {
      state.images = await loadImages(opts.images || []);
      state.script = script;
      state.hook = script.hook;
      state.scenes = script.scenes.map((s) => ({ ...s }));
      if (opts.theme) $("theme").value = opts.theme;
      $("headline").value = opts.headline || "";
      if (opts.handle !== undefined) $("handle").value = opts.handle;
      return totalDur();
    },
    frame(t, quality = 0.92) {
      draw(t);
      return canvas.toDataURL("image/jpeg", quality);
    },
  };
  draw(0);
  loadPosts();
  loadVideos();

  // ---------- 자동 생성 영상 목록 (videos/index.json) ----------
  async function loadVideos() {
    let list;
    try {
      const res = await fetch("videos/index.json", { cache: "no-store" });
      if (!res.ok) return;
      list = await res.json();
    } catch (_) { return; }
    if (!list.length) return;
    const box = $("autoList");
    let shown = 0;
    const more = document.createElement("button");
    more.id = "autoMore";
    more.textContent = "더 보기";
    const addPage = () => {
      list.slice(shown, shown + 6).forEach((v) => {
        const el = document.createElement("div");
        el.className = "auto-item";
        el.innerHTML = `<video controls preload="metadata" playsinline></video><div class="t"></div><div class="m"></div>
          <div class="btns"><a class="dl" download>⬇ MP4</a><button type="button">캡션 복사</button></div>`;
        el.querySelector("video").src = v.video + "#t=0.8";
        el.querySelector(".t").textContent = v.title;
        el.querySelector(".m").textContent = `${v.date} · ${v.duration}초 · ${v.voice}`;
        const a = el.querySelector("a");
        a.href = v.video;
        a.download = `${v.slug}.mp4`;
        const btn = el.querySelector("button");
        btn.addEventListener("click", async () => {
          try {
            const txt = await (await fetch(v.caption, { cache: "no-store" })).text();
            await navigator.clipboard.writeText(txt);
            btn.textContent = "복사됨";
          } catch (_) { btn.textContent = "복사 실패"; }
          setTimeout(() => (btn.textContent = "캡션 복사"), 1200);
        });
        box.appendChild(el);
      });
      shown += 6;
      more.hidden = shown >= list.length;
    };
    more.addEventListener("click", addPage);
    addPage();
    box.after(more);
    $("autoCard").hidden = false;
  }
})();
