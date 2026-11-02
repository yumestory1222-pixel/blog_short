/*
 * 블로그 글 → 30초 쇼츠 대본 생성 (브라우저·Node 공용, 외부 API 없음)
 *
 * 구조: 훅(0~3초) → 핵심 포인트 3~4개 → 행동 유도(CTA)
 * 바이럴 쇼츠 원칙
 *   - 첫 2~3초 안에 "나와 관련 있다"는 신호(지역·금액·마감)를 준다
 *   - 한 화면에 한 가지 정보, 한 줄 12~14자 이내
 *   - 숫자(금액·날짜·인원)는 강조색으로 크게
 *   - 끝은 저장·공유·프로필 링크로 유도
 */
(function (root) {
  "use strict";

  const DISTRICTS = [
    "종로구", "중구", "용산구", "성동구", "광진구", "동대문구", "중랑구", "성북구", "강북구",
    "도봉구", "노원구", "은평구", "서대문구", "마포구", "양천구", "강서구", "구로구", "금천구",
    "영등포구", "동작구", "관악구", "서초구", "강남구", "송파구", "강동구", "서울시",
  ];

  const BENEFIT_WORDS = ["지원", "무료", "혜택", "할인", "지급", "신청", "모집", "최대", "환급", "감면", "바우처", "쿠폰"];
  const URGENT_WORDS = ["마감", "까지", "선착순", "한정", "오늘", "이번 주", "조기"];

  // 금액·날짜·인원 등 강조할 숫자 표현
  const NUM_RE = /(?:최대\s*)?\d[\d,.]*\s*(?:만\s*)?(?:원|만원|억원|%|명|곳|개|가구|세|일|월|년|시간|분|회|대|인당|kg|L|리터)?(?:\s*\d{1,2}\s*일)?/g;
  const MONEY_RE = /(?:최대\s*)?\d[\d,.]*\s*(?:만\s*원|만원|억\s*원|천\s*원|원)/;
  const DATE_RE = /\d{1,2}월\s*\d{1,2}일/;

  function stripMarkdown(md) {
    return String(md || "")
      .replace(/\r/g, "")
      .replace(/^---\n[\s\S]*?\n---\n/, "") // front matter
      .replace(/\{\{[^}]*\}\}|\{%[^%]*%\}/g, "") // liquid
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // 이미지
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // 링크 → 텍스트
      .replace(/<[^>]+>/g, "")
      .replace(/https?:\/\/\S+/g, "")
      .replace(/`{1,3}/g, "")
      .replace(/\*\*|__/g, "")
      .replace(/^\s*>\s?/gm, "");
  }

  function frontMatterTitle(md) {
    const m = String(md || "").match(/^---\n[\s\S]*?\btitle:\s*"?(.+?)"?\s*\n[\s\S]*?\n---/);
    return m ? m[1].trim() : "";
  }

  function cleanLine(s) {
    return s.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").replace(/^#+\s*/, "").replace(/\s+/g, " ").trim();
  }

  /** 마크다운/평문 → { title, facts[], sentences[] } */
  function parsePost(raw, titleHint) {
    const title = (titleHint || frontMatterTitle(raw) || "").trim();
    const text = stripMarkdown(raw);
    const lines = text.split("\n");
    const facts = [];
    const paras = [];
    let firstHeading = "";
    let section = "";
    let inTable = false;

    for (const line of lines) {
      const t = line.trim();
      if (!t) { paras.push(""); inTable = false; continue; }
      if (/^\|/.test(t)) {
        // 요약 섹션의 표만 "첫 칸: 나머지 칸" 사실로 쓴다 (첫 줄은 머리글)
        const cells = t.replace(/^\||\|$/g, "").split("|").map((c) => cleanLine(c));
        const isSep = cells.every((c) => /^:?-{2,}:?$/.test(c));
        if (!inTable) { inTable = true; continue; }
        if (!isSep && /한눈에|요약|핵심|정리/.test(section) && cells.length >= 2 && cells[0].length <= 12) {
          const vals = [...new Set(cells.slice(1).filter(Boolean))];
          facts.push({ label: cells[0], value: vals.join(" / "), section });
        }
        continue;
      }
      inTable = false;
      if (/^#{1,6}\s/.test(t)) {
        section = cleanLine(t);
        if (!firstHeading) firstHeading = section;
        paras.push("");
        continue;
      }
      // "- 무엇을: ..." 형태의 요약 bullet
      const bullet = t.match(/^(?:[-*+]|\d+[.)])\s+(.+)$/);
      if (bullet) {
        const kv = bullet[1].match(/^([^:：]{1,12})\s*[:：]\s*(.+)$/);
        if (kv) facts.push({ label: kv[1].trim(), value: cleanLine(kv[2]), section });
        else if (/[:：]\s*$/.test(bullet[1])) continue; // "지원 내용:" 처럼 값이 하위 목록에 있는 줄
        else facts.push({ label: "", value: cleanLine(bullet[1]), section });
        continue;
      }
      paras.push(t);
    }

    const body = paras.join(" ").replace(/\s+/g, " ").trim();
    const sentences = body
      .split(/(?<=[.!?。]|다\.|요\.|죠\.)\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 8 && s.length <= 140);

    return { title: title || firstHeading || (sentences[0] || "").slice(0, 30), facts, sentences, text: body };
  }

  /** 제목에 있는 구 우선, 본문에 여러 구가 나오면 서울시 전체 글로 본다 */
  function detectDistrict(s, title) {
    const re = (d) => new RegExp("(^|[^가-힣])" + d);
    for (const d of DISTRICTS) if (title && re(d).test(title)) return d;
    if (title && /서울/.test(title) && !DISTRICTS.some((d) => re(d).test(title))) return "서울시";
    const found = DISTRICTS.filter((d) => re(d).test(s));
    if (found.length > 2) return "서울시";
    return found[0] || "";
  }

  function scoreSentence(s) {
    let score = 0;
    if (MONEY_RE.test(s)) score += 4;
    if (/\d/.test(s)) score += 2;
    for (const w of BENEFIT_WORDS) if (s.includes(w)) score += 1.5;
    for (const w of URGENT_WORDS) if (s.includes(w)) score += 1;
    if (s.length > 90) score -= 2;
    if (/문의|전화|☎/.test(s)) score -= 1;
    return score;
  }

  /** 문장을 쇼츠 자막처럼 짧게: 어미 정리, 괄호 제거 */
  function punchy(s, max = 42) {
    let t = s
      .replace(/\([^)]*\)/g, "")
      .replace(/\s+/g, " ")
      .replace(/(입니다|합니다|됩니다|있습니다|했습니다|습니다)\.?$/, (m) => ({
        "입니다": "", "합니다": "해요", "됩니다": "돼요", "있습니다": "있어요", "했습니다": "했어요", "습니다": "어요",
      }[m.replace(/\.$/, "")] ?? ""))
      .replace(/[.。]$/, "")
      .trim();
    if (t.length > max) {
      // 쉼표·조사 경계에서 자르기
      const cut = t.slice(0, max);
      const at = Math.max(cut.lastIndexOf(","), cut.lastIndexOf(" "));
      t = (at > max * 0.5 ? cut.slice(0, at) : cut).replace(/[,\s]+$/, "") + "…";
    }
    return t;
  }

  function factToLine(f) {
    if (!f.label) return punchy(f.value, 40);
    const label = f.label.replace(/\s/g, "");
    const map = { 무엇을: "", 누가: "대상", 대상: "대상", 언제: "기간", 기간: "기간", 어디서: "장소", "비용·신청": "신청", 신청: "신청", 금액: "금액", 문의: "문의" };
    const pre = map[label] !== undefined ? map[label] : f.label;
    return punchy(pre ? `${pre} | ${f.value}` : f.value, 52);
  }

  function firstMatch(re, texts) {
    for (const t of texts) {
      const m = t.match(re);
      if (m) return m[0].replace(/\s+/g, " ").trim();
    }
    return "";
  }

  /** 훅 후보 여러 개 */
  function makeHooks(post) {
    const all = [post.title, ...post.facts.map((f) => f.value), ...post.sentences];
    const district = detectDistrict(all.join(" "), post.title);
    // 혜택 금액만 훅에 쓴다 (과태료·수수료 금액은 제외)
    const benefit = (t) => BENEFIT_WORDS.some((w) => t.includes(w)) && !/과태료|벌금|수수료|부과/.test(t);
    const money = firstMatch(MONEY_RE, [post.title, ...post.facts.filter((f) => /금액|지원/.test(f.label)).map((f) => f.value)])
      || firstMatch(MONEY_RE, all.filter(benefit));
    // "11월 6일까지"처럼 마감으로 쓰인 날짜만 (시행일·시작일은 제외)
    const dl = all.map((t) => t.match(/(\d{1,2}월\s*\d{1,2}일)\s*까지/)).find(Boolean);
    const dm = dl ? dl[1] : "";
    const who = district && district !== "서울시" ? `${district} 주민` : "서울 사는 분";
    const topic = shortTopic(post.title);

    const hooks = [];
    if (money) hooks.push(`${money}, 그냥 놓치실 건가요?`);
    if (dm) hooks.push(`${dm}까지 모르면 끝입니다`);
    hooks.push(`${who}이면 무조건 저장하세요`);
    if (topic) hooks.push(`${topic}, 아직도 모르세요?`);
    hooks.push("이거 모르면 진짜 손해예요");
    if (topic) hooks.push(`30초로 끝내는 ${topic}`);
    return [...new Set(hooks)];
  }

  function shortTopic(title) {
    let t = String(title || "").split(/[,·…!?|:\-—]/)[0].trim();
    t = t.replace(/^(\d{1,2}월\s*\d{1,2}일(부터|까지)?\s*)/, "").replace(/^(서울|[가-힣]+구)\s+/, "").replace(/\s*(안내|공고|알림|모집 공고)$/, "");
    return t.length > 16 ? t.slice(0, 16).replace(/\s+\S*$/, "") : t;
  }

  const CUT_SEC = 2; // 한 컷 길이(초)
  const CUT_MAX = 16; // 한 컷 글자 수 상한 (2초 안에 읽고 들을 수 있는 분량)

  /**
   * 문장·값 → 한 컷 분량(약 16자) 조각들 [{t, end}]  (end: 절이 끝나는 조각)
   * 쉼표·"/"·연결어미 경계에서 먼저 나누고, 길면 단어 단위로 고르게 나눈다. "5만 원", "65세 이상"은 붙여 둔다.
   */
  function chunkText(text, max = CUT_MAX) {
    const NB = "\u00a0";
    const t = punchy(String(text), 400)
      .replace(/…$/, "")
      .replace(/(\d[\d,.]*\s*(?:만|천|억)?)\s+(원|명|곳|개|세|일|회|가구|시간|분)(?=\s|$|[,.)])/g, `$1${NB}$2`)
      .replace(/(\d\s*(?:세|일|년|월|시|원|명|회|개))\s+(이상|이하|미만|초과|까지|부터|이내)/g, `$1${NB}$2`)
      .replace(/(최대|최소|약|총|연|월|1인당|가구당)\s+(?=\d)/g, `$1${NB}`);
    const clauses = t
      .split(/(?<=,)\s+|\s+\/\s+|\s*;\s*|(?<=(?:하고|이고|하며|이며|으며|지만|는데|어서|해서|려면|으면|하면))\s+/)
      .map((c) => c.trim())
      .filter(Boolean);
    const out = [];
    for (const c of clauses) {
      const len = c.length;
      if (len <= max) { out.push({ t: c, end: true }); continue; }
      const n = Math.ceil(len / max);
      const target = len / n;
      const pieces = [];
      let cur = "";
      for (const w of c.split(/ +/)) {
        const next = cur ? cur + " " + w : w;
        if (cur && (next.length > max || cur.length >= target)) { pieces.push(cur); cur = w; }
        else cur = next;
      }
      if (cur) pieces.push(cur);
      pieces.forEach((p, i) => out.push({ t: p, end: i === pieces.length - 1 }));
    }
    // 너무 짧은 조각(5자 미만)은 앞 조각과 합친다
    const merged = [];
    for (const c of out) {
      const prev = merged[merged.length - 1];
      if (prev && (c.t.length < 5 || prev.t.length < 5) && prev.t.length + c.t.length + 1 <= max + 4) {
        prev.t += " " + c.t;
        prev.end = c.end;
      } else merged.push({ ...c });
    }
    return merged.map((c) => ({ t: c.t.replace(/\u00a0/g, " ").replace(/,$/, "").trim(), end: c.end }));
  }

  /** 조각을 n개 이하로: 가능하면 절이 끝나는 곳에서 자르고, 아니면 마지막 조각에 "…" */
  function trimChunks(chunks, n) {
    if (chunks.length <= n) return chunks;
    let k = n;
    while (k > 0 && !chunks[k - 1].end) k--;
    if (k === 0) {
      const kept = chunks.slice(0, n).map((c) => ({ ...c }));
      kept[n - 1].t = kept[n - 1].t.replace(/[,\s]+$/, "") + "…";
      kept[n - 1].end = true;
      return kept;
    }
    return chunks.slice(0, k);
  }

  /**
   * 대본 생성: 2초 × N컷 (30초면 15컷)
   *   1  훅            — 지역·금액·마감으로 멈추게
   *   2  훅 이어받기   — 무엇에 대한 이야기인지
   *   3… 내용 컷       — 요약(대상·기간·금액…)과 핵심 문장을 16자 안팎으로 잘게 나눔. 같은 항목은 라벨 유지
   *   끝 2컷 마무리    — 저장 유도, 공유·채널
   * @returns {{title, hook, hooks[], scenes:[{kind,label,text,dur}], narration, caption, hashtags[]}}
   */
  function buildScript(raw, opts = {}) {
    const total = opts.duration || 30;
    const cuts = Math.max(6, Math.round(total / CUT_SEC));
    const post = parsePost(raw, opts.title);
    const hooks = makeHooks(post);
    const hook = opts.hook || hooks[0];
    const topic = shortTopic(post.title);
    const district = detectDistrict([post.title, post.text].join(" "), post.title);
    const contentCuts = cuts - 4;

    // 내용 그룹: [{label, chunks[]}] — 요약 항목 우선, 모자라면 점수 높은 문장
    const groups = [];
    const seen = new Set();
    const addGroup = (label, text) => {
      const key = text.replace(/\s/g, "").slice(0, 14);
      if (!text || seen.has(key)) return;
      seen.add(key);
      const chunks = trimChunks(chunkText(text), 3);
      if (chunks.length) groups.push({ label, chunks });
    };
    const labelOf = (f) => {
      const map = { 무엇을: "", 누가: "대상", 언제: "기간", 어디서: "장소", "비용·신청": "신청" };
      const l = f.label.replace(/\s/g, "");
      return (map[l] !== undefined ? map[l] : f.label).slice(0, 10);
    };
    const summary = post.facts.filter((f) => f.label && /한눈에|요약|핵심|정리/.test(f.section));
    const labeled = summary.length >= 2 ? summary : post.facts.filter((f) => f.label);
    (labeled.length >= 2 ? labeled : post.facts)
      .filter((f) => f.value && !/문의|출처|원문/.test(f.label))
      .slice(0, 6)
      .forEach((f) => addGroup(f.label ? labelOf(f) : "", f.value));
    const count = () => groups.reduce((a, g) => a + g.chunks.length, 0);
    if (count() < contentCuts) {
      post.sentences
        .map((s, i) => ({ s, i, sc: scoreSentence(s) }))
        .sort((a, b) => b.sc - a.sc)
        .slice(0, 12)
        .sort((a, b) => a.i - b.i)
        .map(({ s }) => ({ s, chunks: chunkText(s) }))
        // 두 컷 안에 끝나는 완결 문장을 먼저, 모자라면 긴 문장도
        .sort((a, b) => (a.chunks.length <= 2 ? 0 : 1) - (b.chunks.length <= 2 ? 0 : 1))
        .forEach(({ s }) => count() < contentCuts && addGroup("", s));
    }

    // 컷 수에 맞추기: 넘치면 각 그룹의 뒤쪽 조각부터 덜어 내고, 그래도 넘치면 뒤 그룹을 뺀다
    while (count() > contentCuts) {
      const g = [...groups].sort((a, b) => b.chunks.length - a.chunks.length)[0];
      if (g.chunks.length > 1) g.chunks = trimChunks(g.chunks, g.chunks.length - 1);
      else groups.pop();
    }

    const content = [];
    groups.forEach((g) => g.chunks.map((c) => c.t).forEach((c) => content.push({ kind: "point", label: g.label, text: g.label ? `${g.label} | ${c}` : c, dur: CUT_SEC })));

    const sub = district && district !== "서울시" && !hook.includes(district)
      ? `${district} 주민 필독!`
      : topic && !hook.includes(topic) ? `${topic}\n핵심만 정리` : "30초 핵심 정리";
    const scenes = [
      { kind: "hook", label: "", text: hook, dur: CUT_SEC },
      { kind: "sub", label: "", text: sub, dur: CUT_SEC },
      ...content,
      { kind: "cta", label: "", text: "저장 필수!\n나중에 꼭 필요해요", dur: CUT_SEC },
      { kind: "cta", label: "", text: opts.cta || "필요한 분께\n공유해 주세요", dur: CUT_SEC },
    ];

    const tags = ["쇼츠", "생활정보", "꿀팁"];
    if (district) tags.unshift(district.replace(/\s/g, ""), "서울");
    const kw = (post.title.match(/[가-힣]{2,8}/g) || []).filter(
      (w) => !/(요|까|다|서|고|는|을|를|의|에|만|원|명|지|터|로|일)$/.test(w) && !/^(서울|총정리|안내|지원|최대)$/.test(w) && w !== district
    );
    kw.slice(0, 4).forEach((w) => tags.push(w));

    const caption = `${hook}\n\n${groups.map((g) => "✔ " + (g.label ? g.label + ": " : "") + g.chunks.map((c) => c.t).join(" ")).join("\n")}\n\n자세한 내용은 프로필 링크에서 확인하세요.`;
    return { title: post.title, hook, hooks, scenes, narration: narrationLines(scenes).join("\n"), caption, hashtags: [...new Set(tags)].map((t) => "#" + t) };
  }

  /** 컷별 읽을 문장 (라벨은 화면에 보이므로 짧을 때만 읽음) */
  function narrationLines(scenes) {
    let prev = null;
    return scenes.map((s) => {
      const m = s.text.match(/^(.{1,14}?)\s*\|\s*([\s\S]+)$/);
      const label = m ? m[1] : "";
      const body = (m ? m[2] : s.text).replace(/\n/g, " ");
      // 라벨은 화면에만 (2초 안에 읽으려면 본문만). 단, 본문이 아주 짧으면 첫 컷에서 라벨도 읽는다
      const line = label && label !== prev && body.length + label.length <= 14 ? `${label}, ${body}` : body;
      prev = label || null;
      return line.replace(/…/g, "").replace(/\s+/g, " ").trim();
    });
  }

  /** 줄바꿈: 한 줄 maxChars 이내, 띄어쓰기 기준 */
  function wrapKorean(text, maxChars) {
    const out = [];
    for (const para of String(text).split("\n")) {
      let line = "";
      for (const word of para.split(/\s+/).filter(Boolean)) {
        if (!line) line = word;
        else if ((line + " " + word).length <= maxChars) line += " " + word;
        else { out.push(line); line = word; }
        while (line.length > maxChars + 2) { out.push(line.slice(0, maxChars)); line = line.slice(maxChars); }
      }
      if (line) out.push(line);
    }
    return out;
  }

  /** 강조할 숫자 구간 [start,end) */
  function numberSpans(line) {
    const spans = [];
    NUM_RE.lastIndex = 0;
    let m;
    while ((m = NUM_RE.exec(line))) {
      if (!m[0].trim()) { NUM_RE.lastIndex++; continue; }
      spans.push([m.index, m.index + m[0].trimEnd().length]);
    }
    return spans;
  }

  const api = { parsePost, buildScript, chunkText, narrationLines, makeHooks, wrapKorean, numberSpans, punchy, shortTopic, detectDistrict };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ShortsScript = api;
})(typeof window !== "undefined" ? window : globalThis);
