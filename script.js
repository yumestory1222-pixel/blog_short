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
  const NUM_RE = /(?:최대\s*)?\d[\d,.]*\s*(?:만\s*)?(?:원|만원|억원|%|명|곳|개|가구|세|일|월|년|시간|분|회|kg|L|리터)?(?:\s*\d{1,2}\s*일)?/g;
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

  /**
   * 대본 생성
   * @returns {{title, hook, hooks[], scenes:[{kind,label,text,dur}], narration, caption, hashtags[]}}
   */
  function buildScript(raw, opts = {}) {
    const total = opts.duration || 30;
    const post = parsePost(raw, opts.title);
    const hooks = makeHooks(post);
    const hook = opts.hook || hooks[0];

    // 포인트 후보: 요약 bullet 우선, 부족하면 점수 높은 문장
    const points = [];
    const seen = new Set();
    const push = (t) => {
      const key = t.replace(/\s/g, "").slice(0, 14);
      if (!t || seen.has(key)) return;
      seen.add(key);
      points.push(t);
    };
    // 라벨 있는 요약(무엇을/대상/기간…)이 있으면 그것만, 없으면 일반 bullet
    const summary = post.facts.filter((f) => f.label && /한눈에|요약|핵심|정리/.test(f.section));
    const labeled = summary.length >= 2 ? summary : post.facts.filter((f) => f.label);
    (labeled.length >= 2 ? labeled : post.facts)
      .filter((f) => f.value && !/문의|출처|원문/.test(f.label))
      .slice(0, 4)
      .forEach((f) => push(factToLine(f)));
    if (points.length < 4) {
      post.sentences
        .map((s, i) => ({ s, i, sc: scoreSentence(s) }))
        .sort((a, b) => b.sc - a.sc)
        .slice(0, 8)
        .sort((a, b) => a.i - b.i)
        .forEach(({ s }) => points.length < 4 && push(punchy(s)));
    }
    while (points.length < 3) push(punchy(post.sentences[points.length] || post.title || "핵심만 빠르게 정리했어요"));

    const n = points.length;
    const hookDur = 3;
    const ctaDur = 4;
    const pointDur = Math.max(2, (total - hookDur - ctaDur) / n);

    const scenes = [
      { kind: "hook", label: "", text: hook, dur: hookDur },
      ...points.map((t, i) => ({ kind: "point", label: `POINT ${i + 1}`, text: t, dur: +pointDur.toFixed(1) })),
      { kind: "cta", label: "", text: opts.cta || "저장해두고\n필요한 분께 공유하세요", dur: ctaDur },
    ];

    const district = detectDistrict([post.title, post.text].join(" "), post.title);
    const tags = ["쇼츠", "생활정보", "꿀팁"];
    if (district) tags.unshift(district.replace(/\s/g, ""), "서울");
    const kw = (post.title.match(/[가-힣]{2,8}/g) || []).filter(
      (w) => !/(요|까|다|서|고|는|을|를|의|에|만|원|명|지|터|로|일)$/.test(w) && !/^(서울|총정리|안내|지원|최대)$/.test(w) && w !== district
    );
    kw.slice(0, 4).forEach((w) => tags.push(w));

    const narration = scenes.map((s) => s.text.replace(/\n/g, " ").replace(/\s*\|\s*/g, ", ")).join("\n");
    const caption = `${hook}\n\n${points.map((p) => "✔ " + p.replace(/\s*\|\s*/g, ": ")).join("\n")}\n\n자세한 내용은 프로필 링크에서 확인하세요.`;

    return { title: post.title, hook, hooks, scenes, narration, caption, hashtags: [...new Set(tags)].map((t) => "#" + t) };
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

  const api = { parsePost, buildScript, makeHooks, wrapKorean, numberSpans, punchy, shortTopic, detectDistrict };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ShortsScript = api;
})(typeof window !== "undefined" ? window : globalThis);
