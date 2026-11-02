"""블로그 주소 → 제목·본문(마크다운 비슷한 텍스트)·본문 이미지 목록

네이버 블로그(blog.naver.com / m.blog.naver.com), 티스토리, 일반 웹페이지(<article>·og 태그)를 지원합니다.
단독 실행: python tools/fetch_post.py <주소>   → JSON 출력
"""
from __future__ import annotations

import json
import re
import sys
from urllib.parse import parse_qs, urljoin, urlparse

import requests
from bs4 import BeautifulSoup

UA = (
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36"
)
SKIP_IMG = re.compile(r"sticker|emoji|emoticon|profile|favicon|logo|icon|blank|spacer|btn_|ico_|\.svg|\.gif(\?|$)", re.I)


def normalize_url(url: str) -> str:
    """네이버 블로그는 본문이 iframe 안에 있어 모바일 주소로 바꿔 읽는다"""
    u = urlparse(url.strip())
    host = u.netloc.lower()
    if host.endswith("blog.naver.com"):
        q = parse_qs(u.query)
        if "blogId" in q and "logNo" in q:
            return f"https://m.blog.naver.com/{q['blogId'][0]}/{q['logNo'][0]}"
        parts = [p for p in u.path.split("/") if p]
        if len(parts) >= 2 and parts[1].isdigit():
            return f"https://m.blog.naver.com/{parts[0]}/{parts[1]}"
    return url.strip()


def image_url(src: str) -> str:
    """네이버 이미지는 외부에서 열리는 주소·큰 크기로"""
    src = src.strip()
    if "pstatic.net" in src:
        src = src.replace("postfiles.pstatic.net", "mblogthumb-phinf.pstatic.net")
        src = re.sub(r"\?type=\w+", "", src) + "?type=w966"
    return src


def _text(el) -> str:
    return re.sub(r"\s+", " ", el.get_text(" ", strip=True)).strip()


def to_markdown(root) -> str:
    out: list[str] = []
    for el in root.find_all(["h1", "h2", "h3", "h4", "p", "li", "tr", "blockquote"]):
        if el.find_parent(["li", "tr"]) and el.name not in ("li", "tr"):
            continue  # 목록·표 안의 문단은 목록·표로 한 번만
        t = _text(el)
        if not t or len(t) < 2:
            continue
        if el.name in ("h1", "h2", "h3", "h4"):
            out.append(f"\n## {t}\n")
        elif el.name == "li":
            out.append(f"- {t}")
        elif el.name == "tr":
            cells = [_text(c) for c in el.find_all(["td", "th"])]
            if any(cells):
                out.append("| " + " | ".join(cells) + " |")
        else:
            out.append(t + "\n")
    md = "\n".join(out)
    if len(md) < 80:  # 구조가 없는 글: 줄 단위 텍스트
        md = "\n".join(line.strip() for line in root.get_text("\n").splitlines() if line.strip())
    return re.sub(r"\n{3,}", "\n\n", md).strip()


def fetch(url: str) -> dict:
    src_url = normalize_url(url)
    res = requests.get(src_url, headers={"User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9"}, timeout=30)
    res.raise_for_status()
    res.encoding = res.apparent_encoding if res.encoding in (None, "ISO-8859-1") else res.encoding
    soup = BeautifulSoup(res.text, "html.parser")

    def meta(prop: str) -> str:
        m = soup.find("meta", attrs={"property": prop}) or soup.find("meta", attrs={"name": prop})
        return (m.get("content") or "").strip() if m else ""

    # 본문 영역: 네이버(스마트에디터) → 티스토리 → article → 가장 글자가 많은 div
    root = (
        soup.select_one(".se-main-container")
        or soup.select_one("#postViewArea, #viewTypeSelector")
        or soup.select_one(".tt_article_useless_p_margin, .entry-content, .article-view, .post-content, .post-body")
        or soup.find("article")
        or soup.find("main")
    )
    if root is None:
        divs = soup.find_all("div")
        root = max(divs, key=lambda d: len(d.get_text(strip=True)), default=soup.body or soup)
    for bad in root.find_all(["script", "style", "noscript", "nav", "footer", "aside", "form"]):
        bad.decompose()

    title = (
        _text(soup.select_one(".se-title-text")) if soup.select_one(".se-title-text") else ""
    ) or meta("og:title") or (soup.title.get_text(strip=True) if soup.title else "")
    title = re.sub(r"\s*[:|-]\s*네이버 블로그$", "", title)

    images: list[str] = []
    og = meta("og:image")
    for img in root.find_all("img"):
        src = img.get("data-lazy-src") or img.get("data-src") or img.get("data-original") or img.get("src") or ""
        if not src or src.startswith("data:") or SKIP_IMG.search(src):
            continue
        w = img.get("width") or img.get("data-width") or ""
        if w.isdigit() and int(w) < 200:
            continue
        images.append(image_url(urljoin(src_url, src)))
    if og and not SKIP_IMG.search(og):
        images.insert(0, image_url(urljoin(src_url, og)))
    seen: set[str] = set()
    images = [i for i in images if not (i in seen or seen.add(i))][:12]

    return {"url": url.strip(), "title": title, "md": to_markdown(root), "images": images}


def download(url: str, referer: str) -> tuple[bytes, str] | None:
    """이미지 받기 (작은 아이콘·실패는 None)"""
    try:
        r = requests.get(url, headers={"User-Agent": UA, "Referer": referer}, timeout=30)
        ctype = r.headers.get("content-type", "").split(";")[0].strip()
        if r.ok and ctype.startswith("image/") and "svg" not in ctype and len(r.content) > 8000:
            return r.content, ctype
    except requests.RequestException:
        pass
    return None


if __name__ == "__main__":
    data = fetch(sys.argv[1])
    data["md"] = data["md"][:1500]
    print(json.dumps(data, ensure_ascii=False, indent=1))
