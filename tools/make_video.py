"""블로그 글 → 음성 내레이션이 들어간 30초 쇼츠 MP4 자동 생성

흐름: posts.json 의 글 → 대본(script.js) → 장면별 Edge 신경망 음성(edge-tts)
      → 장면 길이를 음성 길이에 맞춤 → 웹 쇼츠 메이커와 같은 캔버스 렌더러로 프레임 단위 렌더링
      → ffmpeg 로 영상·내레이션·효과음(·배경음악) 합성 → videos/<slug>.mp4

사용 예
  python tools/make_video.py --new                 # 아직 영상이 없는 글만 (최대 --limit 개)
  python tools/make_video.py --only 0              # posts.json 의 0번째 글
  python tools/make_video.py --new --voice ko-KR-InJoonNeural --bgm music.mp3

필요: node, ffmpeg, python 패키지 edge-tts·playwright (+ playwright 용 chromium)
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import concurrent.futures
import functools
import hashlib
import http.server
import json
import math
import os
import re
import struct
import subprocess
import sys
import tempfile
import threading
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VIDEOS = ROOT / "videos"
FPS = 30
VOICES = {
    "ko-KR-SunHiNeural": "선희(여)",
    "ko-KR-InJoonNeural": "인준(남)",
    "ko-KR-HyunsuMultilingualNeural": "현수(남)",
}


# ---------- 대본 ----------
def slug_of(post: dict) -> str:
    h = hashlib.sha1((post.get("url") or post["title"]).encode("utf-8")).hexdigest()[:8]
    return f"{post['date']}-{h}"


def build_script(post: dict, duration: int) -> dict:
    with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False, encoding="utf-8") as f:
        f.write(post.get("md") or "")
        md_path = f.name
    try:
        out = subprocess.run(
            ["node", str(ROOT / "tools" / "script_cli.js"), md_path, post["title"], str(duration)],
            check=True, capture_output=True, text=True, encoding="utf-8",
        ).stdout
    finally:
        os.unlink(md_path)
    return json.loads(out)


def narration_text(scene: dict) -> str:
    t = scene["text"].replace("\n", " ")
    t = re.sub(r"^(.{1,14}?)\s*\|\s*", r"\1, ", t)  # "대상 | …" → "대상, …"
    t = t.replace("…", "").replace("·", ", ").replace("~", "부터 ")
    return re.sub(r"\s+", " ", t).strip()


def fix_reading(t: str) -> str:
    """읽기 어색한 기호 다듬기"""
    t = t.replace("…", "").replace("~", " 부터 ").replace("「", "").replace("」", "")
    return re.sub(r"\s+", " ", t).strip()


# ---------- 음성 ----------
async def _edge_tts(text: str, out: Path, voice: str, rate: str) -> None:
    import edge_tts

    proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy") or None
    await edge_tts.Communicate(text, voice, rate=rate, proxy=proxy).save(str(out))


def tts(text: str, out: Path, voice: str, rate: str, engine: str) -> None:
    if engine == "beep":  # 네트워크 없이 파이프라인만 시험할 때: 글자 수에 비례한 길이의 낮은 톤
        write_tone(out.with_suffix(".wav"), 0.12 * len(text) + 0.3, 220, 0.05)
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(out.with_suffix(".wav")), str(out)], check=True)
        return
    err: Exception | None = None
    for attempt in range(3):
        try:
            # Playwright(sync)가 이미 이벤트 루프를 돌리고 있어 별도 스레드에서 실행
            with concurrent.futures.ThreadPoolExecutor(1) as ex:
                ex.submit(asyncio.run, _edge_tts(text, out, voice, rate)).result(timeout=60)
            if out.stat().st_size > 0:
                return
        except Exception as e:  # 일시 오류 재시도
            err = e
    raise RuntimeError(f"음성 생성 실패: {err}")


def audio_len(path: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        check=True, capture_output=True, text=True,
    ).stdout
    return float(out.strip())


def write_tone(path: Path, sec: float, f0: float, vol: float, f1: float | None = None) -> None:
    """간단한 효과음(사인파, 주파수 미끄러짐 + 감쇠)"""
    sr = 44100
    n = int(sr * sec)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        frames = bytearray()
        phase = 0.0
        for i in range(n):
            x = i / n
            f = f0 if f1 is None else f0 * (f1 / f0) ** x
            phase += 2 * math.pi * f / sr
            env = min(1.0, i / (sr * 0.005)) * (1 - x) ** 2 if f1 is not None else 1.0
            frames += struct.pack("<h", int(32767 * vol * env * math.sin(phase)))
        w.writeframes(bytes(frames))


# ---------- 렌더링 ----------
class _QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):  # noqa: D401
        pass


def serve() -> tuple[http.server.ThreadingHTTPServer, int]:
    handler = functools.partial(_QuietHandler, directory=str(ROOT))
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, srv.server_address[1]


def render(page, script: dict, opts: dict, audio: Path, out: Path) -> float:
    total = page.evaluate("async ([s, o]) => await ShortsApp.load(s, o)", [script, opts])
    n = int(math.ceil(total * FPS))
    ff = subprocess.Popen(
        [
            "ffmpeg", "-v", "error", "-y",
            "-f", "image2pipe", "-framerate", str(FPS), "-c:v", "mjpeg", "-i", "-",
            "-i", str(audio),
            "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart",
            str(out),
        ],
        stdin=subprocess.PIPE,
    )
    for i in range(n):
        data = page.evaluate("t => ShortsApp.frame(t)", min(i / FPS, total - 0.001))
        ff.stdin.write(base64.b64decode(data.split(",", 1)[1]))
    ff.stdin.close()
    if ff.wait() != 0:
        raise RuntimeError("ffmpeg 인코딩 실패")
    return total


def mix_audio(clips: list[tuple[float, Path]], sfx: list[tuple[float, Path]], total: float, bgm: Path | None, out: Path) -> None:
    if not clips and not sfx and not bgm:  # 소리 없는 영상
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-t", f"{total:.2f}", str(out)], check=True)
        return
    inputs: list[str] = []
    parts: list[str] = []
    labels: list[str] = []
    k = 0
    for start, path in clips + sfx:
        inputs += ["-i", str(path)]
        ms = int(start * 1000)
        parts.append(f"[{k}:a]aresample=44100,aformat=channel_layouts=stereo,adelay={ms}|{ms}[a{k}]")
        labels.append(f"[a{k}]")
        k += 1
    if bgm:
        inputs += ["-stream_loop", "-1", "-i", str(bgm)]
        parts.append(
            f"[{k}:a]aresample=44100,aformat=channel_layouts=stereo,volume=0.12,"
            f"atrim=0:{total:.2f},afade=t=out:st={max(0, total - 1.2):.2f}:d=1.2[a{k}]"
        )
        labels.append(f"[a{k}]")
        k += 1
    parts.append(f"{''.join(labels)}amix=inputs={k}:normalize=0:duration=longest,apad,atrim=0:{total:.2f}[out]")
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", ";".join(parts), "-map", "[out]", "-ar", "44100", str(out)],
        check=True,
    )


# ---------- 전체 ----------
def make_one(page, post: dict, args, work: Path) -> dict:
    slug = slug_of(post)
    script = post.get("script") or build_script(post, args.duration)
    scenes = script["scenes"]
    clips: list[tuple[float, Path]] = []
    sfx: list[tuple[float, Path]] = []
    blip_hook, blip = work / "hook.wav", work / "blip.wav"
    write_tone(blip_hook, 0.3, 180, 0.35, 60)
    write_tone(blip, 0.14, 900, 0.18, 1500)

    lines = script["narration"].split("\n")
    t = 0.0
    prev = None
    for i, s in enumerate(scenes):
        if args.tts == "none":  # 음성 없이: 컷 길이 그대로, 효과음만
            key = (s["kind"], s.get("label") or "")
            if not args.no_sfx and key != prev:
                sfx.append((t, blip_hook if s["kind"] == "hook" else blip))
            prev = key
            t += s["dur"]
            continue
        raw = work / f"{slug}-{i}-raw.mp3"
        mp3 = work / f"{slug}-{i}.mp3"
        tts(fix_reading(lines[i] if i < len(lines) else narration_text(s)), raw, args.voice, args.rate, args.tts)
        lead = 0.05  # 화면이 뜬 뒤 말 시작
        room = s["dur"] - lead - 0.08  # 다음 컷 전에 말이 끝나야 함
        speak = audio_len(raw)
        if speak > room:
            # 컷 길이(2초)에 맞춰 빠르게 (음높이 유지). 1.8배를 넘으면 그 컷만 조금 늘린다
            speed = min(speak / room, 1.8)
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(raw), "-filter:a", f"atempo={speed:.3f}", str(mp3)], check=True)
            speak = audio_len(mp3)
            if speak > room:
                print(f"  · {i + 1}컷 음성이 길어 {speak + lead + 0.08:.1f}초로 늘림: {lines[i] if i < len(lines) else ''}")
                s["dur"] = round(speak + lead + 0.08, 2)
        else:
            mp3 = raw
        clips.append((t + lead, mp3))
        key = (s["kind"], s.get("label") or "")
        if not args.no_sfx and key != prev:  # 훅·새 항목 시작에만 효과음
            sfx.append((t, blip_hook if s["kind"] == "hook" else blip))
        prev = key
        t += s["dur"]
    total = t

    mix = work / f"{slug}.wav"
    mix_audio(clips, sfx, total, Path(args.bgm) if args.bgm else None, mix)

    district = script.get("district") or post.get("district") or ""
    # 다른 블로그 글(--url)은 채널 이름을 넣으라고 할 때만 표시
    handle = args.handle if args.handle is not None else ("" if post.get("url") else "@서울우리동네정책")
    opts = {"theme": args.theme, "handle": handle, "headline": f"{district} 새 소식" if district else ""}
    opts["images"] = post.get("image_data", [])
    VIDEOS.mkdir(exist_ok=True)
    out = VIDEOS / f"{slug}.mp4"
    render(page, script, opts, mix, out)

    caption = (
        f"{script['hook']}\n\n"
        + "\n".join("✔ " + re.sub(r"\s*\|\s*", ": ", s["text"]).replace("\n", " ") for s in scenes if s["kind"] == "point")
        + "\n\n자세한 내용은 프로필 링크에서 확인하세요.\n\n"
        + " ".join(script["hashtags"])
    )
    if post.get("caption_text"):
        caption = post["caption_text"].rstrip() + ("\n\n" + " ".join(script["hashtags"]) if script["hashtags"] else "")
    (VIDEOS / f"{slug}.txt").write_text(caption + "\n", encoding="utf-8")
    print(f"✔ {out.name}  {total:.1f}초  {post['title']}")
    return {
        "slug": slug, "title": post["title"], "date": post["date"], "district": district,
        "video": f"videos/{slug}.mp4", "caption": f"videos/{slug}.txt",
        "duration": round(total, 1), "voice": VOICES.get(args.voice, args.voice),
        **({"source": post["url"]} if post.get("url") else {}),
    }


def load_url(url: str) -> dict:
    """블로그 주소 → 글 + 배경 그림(data URL)"""
    import datetime

    sys.path.insert(0, str(ROOT / "tools"))
    from fetch_post import download, fetch, normalize_url

    post = fetch(url)
    post["date"] = datetime.date.today().isoformat()
    post["image_data"] = []
    for src in post["images"]:
        got = download(src, normalize_url(url))
        if got:
            data, ctype = got
            post["image_data"].append(f"data:{ctype};base64," + base64.b64encode(data).decode())
        if len(post["image_data"]) >= 8:
            break
    print(f"· {post['title']} — 본문 {len(post['md'])}자, 그림 {len(post['image_data'])}/{len(post['images'])}장")
    if len(post["md"]) < 50:
        raise SystemExit(f"본문을 읽지 못했습니다: {url}")
    return post


def load_script(path: str) -> dict:
    """직접 쓴 대본(JSON) → 글 + 대본. 형식:
    {"url": "블로그 주소", "title": "...", "cuts": [{"text": "...", "label": "", "kind": "hook|sub|point|cta"}, ...],
     "caption": "(선택)", "hashtags": ["#..."]}
    kind 를 비우면 1컷 hook, 2컷 sub, 마지막 2컷 cta, 나머지 point. 컷마다 dur(초) 생략 시 2초.
    """
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    cuts = data["cuts"]
    n = len(cuts)
    scenes = []
    for i, c in enumerate(cuts):
        kind = c.get("kind") or ("hook" if i == 0 else "sub" if i == 1 else "cta" if i >= n - 2 else "point")
        label = c.get("label", "")
        text = c["text"]
        scenes.append({"kind": kind, "label": label, "text": f"{label} | {text}" if label else text, "dur": float(c.get("dur", 2))})
    hashtags = data.get("hashtags") or []
    script = {
        "title": data.get("title", ""), "hook": cuts[0]["text"].replace("\n", " "), "hooks": [], "scenes": scenes,
        "narration": "\n".join(c["text"].replace("\n", " ") for c in cuts),
        "hashtags": hashtags, "district": data.get("district", ""),
    }
    post = load_url(data["url"]) if data.get("url") else {"title": data.get("title", ""), "date": "", "md": "", "image_data": []}
    if not post.get("date"):
        import datetime
        post["date"] = datetime.date.today().isoformat()
    if data.get("title"):
        post["title"] = data["title"]
    post["script"] = script
    post["caption_text"] = data.get("caption")
    return post


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--posts", default=str(ROOT / "posts.json"))
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--new", action="store_true", help="영상이 아직 없는 글만")
    g.add_argument("--only", help="posts.json 순번(0부터) 또는 slug, 쉼표로 여러 개")
    g.add_argument("--all", action="store_true", help="모든 글 다시 만들기")
    g.add_argument("--url", nargs="+", help="블로그 주소로 만들기 (본문 그림을 배경으로 사용)")
    g.add_argument("--script", help="직접 쓴 대본 JSON 으로 만들기 (scripts/*.json, 형식은 load_script 참고)")
    ap.add_argument("--limit", type=int, default=3, help="한 번에 만들 최대 개수 (--new)")
    ap.add_argument("--duration", type=int, default=30, help="대본 목표 길이(초). 실제 길이는 음성에 맞춰짐")
    ap.add_argument("--voice", default="ko-KR-SunHiNeural", help=", ".join(VOICES))
    ap.add_argument("--rate", default="+30%", help="말하기 속도, 예: +0%%, +20%%")
    ap.add_argument("--theme", default="pop", choices=["pop", "news", "pastel"])
    ap.add_argument("--handle", default=None, help="마무리 컷 채널 이름 (기본: 블로그 글은 @서울우리동네정책, --url 은 표시 안 함)")
    ap.add_argument("--bgm", help="배경 음악 파일 (선택)")
    ap.add_argument("--no-sfx", action="store_true", help="장면 전환 효과음 끄기")
    ap.add_argument("--tts", default="edge", choices=["edge", "none", "beep"], help="none: 음성 없이(효과음만), beep: 파이프라인 시험")
    ap.add_argument("--fetch-only", action="store_true", help="--url 글의 본문·그림 주소만 sources/<slug>.json 으로 저장")
    args = ap.parse_args()

    posts = json.loads(Path(args.posts).read_text(encoding="utf-8"))
    index_path = VIDEOS / "index.json"
    index = json.loads(index_path.read_text(encoding="utf-8")) if index_path.exists() else []
    done = {v["slug"] for v in index}

    if args.url and args.fetch_only:
        sys.path.insert(0, str(ROOT / "tools"))
        from fetch_post import fetch

        (ROOT / "sources").mkdir(exist_ok=True)
        for u in args.url:
            data = fetch(u)
            import datetime

            out = ROOT / "sources" / f"{slug_of({'url': u, 'title': '', 'date': datetime.date.today().isoformat()})}.json"
            out.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
            print(f"· {out.relative_to(ROOT)}  {data['title']}  본문 {len(data['md'])}자, 그림 {len(data['images'])}장")
        return
    if args.script:
        todo = [load_script(args.script)]
    elif args.url:
        todo = [load_url(u) for u in args.url]
    elif args.only:
        keys = [k.strip() for k in args.only.split(",")]
        todo = [p for i, p in enumerate(posts) if str(i) in keys or slug_of(p) in keys]
    elif args.all:
        todo = posts
    else:
        todo = [p for p in posts if slug_of(p) not in done][: args.limit]
    if not todo:
        print("VIDEOS=0 (새로 만들 영상 없음)")
        return

    from playwright.sync_api import sync_playwright

    srv, port = serve()
    made = []
    try:
        with sync_playwright() as pw, tempfile.TemporaryDirectory() as tmp:
            exe = os.environ.get("CHROMIUM_PATH")  # 미리 설치된 크롬을 쓸 때
            browser = pw.chromium.launch(executable_path=exe or None, args=["--no-sandbox"])
            page = browser.new_page(viewport={"width": 1200, "height": 900})
            page.goto(f"http://127.0.0.1:{port}/index.html")
            page.evaluate("() => ShortsApp.ready()")
            for post in todo:
                try:
                    made.append(make_one(page, post, args, Path(tmp)))
                except Exception as e:  # 한 글이 실패해도 나머지는 계속
                    print(f"✘ {post['title']}: {e}", file=sys.stderr)
            browser.close()
    finally:
        srv.shutdown()

    by_slug = {v["slug"]: v for v in index}
    for v in made:
        by_slug[v["slug"]] = v
    merged = sorted(by_slug.values(), key=lambda v: (v["date"], v["slug"]), reverse=True)
    VIDEOS.mkdir(exist_ok=True)
    index_path.write_text(json.dumps(merged, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"VIDEOS={len(made)}")
    if len(made) < len(todo):
        sys.exit(1)


if __name__ == "__main__":
    main()
