"""블로그 글(Jekyll _posts) → posts.json (쇼츠 메이커의 「글 불러오기」 목록)

사용: python tools/build_posts.py ../-blog_auto/docs/_posts
"""
import json
import re
import sys
from pathlib import Path


def parse(path: Path) -> dict | None:
    text = path.read_text(encoding="utf-8")
    m = re.match(r"^---\n(.*?)\n---\n(.*)$", text, re.S)
    if not m:
        return None
    fm, body = m.groups()

    def field(name: str) -> str:
        f = re.search(rf'^{name}:\s*"?(.*?)"?\s*$', fm, re.M)
        return f.group(1).strip() if f else ""

    cats = re.findall(r'"([^"]+)"', field("categories"))
    body = re.sub(r"\{\{[^}]*\}\}|\{%[^%]*%\}", "", body)
    return {
        "title": field("title"),
        "date": field("date")[:10] or path.name[:10],
        "district": cats[0] if cats else "",
        "md": body.strip(),
    }


def main() -> None:
    src = Path(sys.argv[1] if len(sys.argv) > 1 else "../-blog_auto/docs/_posts")
    posts = [p for p in (parse(f) for f in sorted(src.glob("*.md"), reverse=True)) if p and p["title"]]
    out = Path(__file__).resolve().parent.parent / "posts.json"
    out.write_text(json.dumps(posts[:60], ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"posts.json: {len(posts[:60])}개")


if __name__ == "__main__":
    main()
