# 블로그 → 30초 쇼츠 메이커

블로그 글을 붙여 넣으면 30초 세로 쇼츠(1080×1920) 영상으로 만들어 주는 웹 도구입니다.
모든 처리는 브라우저 안에서 이뤄집니다 (서버·API 비용 없음).

**주소:** https://yumestory1222-pixel.github.io/blog_short/

## 기능

- 「서울 우리동네 새 정책」 블로그 글을 목록에서 고르거나, 아무 글이나 붙여 넣기
- 대본 자동 구성: 훅(3초, 지역·금액·마감 기반 후보 여러 개) → 핵심 포인트 3~4개(「한눈에 보기」 요약 우선) → 저장·공유 유도
- 장면 문구·길이 편집, 스타일 3종, 상단 고정 제목, 배경 사진(켄 번즈), 배경 음악, 전환 효과음, 진행 바
- 「영상 내려받기」: 실시간 녹화 → MP4(크롬) 또는 WebM
- 캡션·해시태그·내레이션 대본 복사, 썸네일 PNG 저장

## 파일

| 파일 | 역할 |
|---|---|
| `index.html` | 화면 |
| `script.js` | 글 → 대본(훅·포인트·CTA) 규칙 기반 생성 |
| `app.js` | 캔버스 렌더링, 미리보기, 녹화 |
| `posts.json` | 「글 불러오기」 목록 (`tools/build_posts.py` 로 생성) |

## 블로그 글 목록 갱신

블로그 저장소(`-blog_auto`)와 나란히 받아 두고 실행합니다.

```bash
python tools/build_posts.py ../-blog_auto/docs/_posts
```

## GitHub Pages 켜기

Settings → Pages → Source: *Deploy from a branch*, Branch: `main` / `/ (root)`
