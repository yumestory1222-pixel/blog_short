# 블로그 → 30초 쇼츠 메이커

블로그 글을 붙여 넣으면 30초 세로 쇼츠(1080×1920) 영상으로 만들어 주는 웹 도구입니다.
모든 처리는 브라우저 안에서 이뤄집니다 (서버·API 비용 없음).

**주소:** https://yumestory1222-pixel.github.io/blog_short/

## 기능

- **블로그 주소로 만들기**: 주소를 넣고 「불러오기」 → 글 내용으로 대본, 글 속 그림으로 장면 배경
  (브라우저에서는 공개 리더 r.jina.ai 와 이미지 프록시 images.weserv.nl 을 거칩니다)

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
| `tools/make_video.py` | 음성 포함 MP4 자동 생성 |
| `.github/workflows/shorts.yml` | posts.json 변경 시 자동 실행 |
| `posts.json` | 「글 불러오기」 목록 (`tools/build_posts.py` 로 생성) |

## 음성 포함 쇼츠 자동 생성

`posts.json` 이 바뀌면 GitHub Actions(「쇼츠 자동 생성」)가 아직 영상이 없는 글마다

1. 대본 생성(`script.js`) → 2. 장면별 Edge 신경망 음성(`edge-tts`, 기본 선희) →
3. 장면 길이를 음성 길이에 맞춤 → 4. 웹과 같은 캔버스 렌더러로 30fps 렌더링 → 5. ffmpeg 로 MP4 합성

을 거쳐 `videos/<날짜>-<해시>.mp4` 와 캡션(`.txt`)을 커밋합니다. 사이트 맨 위 「자동으로 만든 쇼츠」에서 보고 내려받습니다.
Actions 탭 → 쇼츠 자동 생성 → *Run workflow* 에서
- 「블로그 주소」에 아무 블로그 글 주소를 넣으면 그 글로, 글 속 그림을 배경으로 음성 포함 영상을 만듭니다 (`tools/fetch_post.py`).
- 「다시 만들 글」로 특정 글을 다른 목소리·스타일로 다시 만들 수 있습니다.

로컬 실행: `python tools/make_video.py --new` (node, ffmpeg, `pip install edge-tts playwright` 필요)
- `edge-tts` 는 마이크로소프트 Edge 의 읽어주기 서비스를 쓰는 비공식 도구입니다. 상업적 이용 조건이 명확하지 않으니 참고하세요.

## 블로그 글 목록 갱신

블로그 저장소(`-blog_auto`)와 나란히 받아 두고 실행합니다.

```bash
python tools/build_posts.py ../-blog_auto/docs/_posts
```

## GitHub Pages 켜기

Settings → Pages → Source: *Deploy from a branch*, Branch: `main` / `/ (root)`
