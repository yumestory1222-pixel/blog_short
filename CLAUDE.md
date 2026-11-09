# 블로그 → 30초 쇼츠 메이커

## "이 주소로 쇼츠 만들어줘" (Claude 가 대본 작성)

이 세션 환경에서는 네이버 등 외부 블로그에 직접 접속이 안 되므로 GitHub Actions 「쇼츠 자동 생성」(shorts.yml)을 거친다.

1. 글 가져오기: 워크플로 실행 `url=<주소>`, `mode=글만 가져오기` → `sources/<날짜>-<해시>.json` 커밋됨 (`git pull` 후 읽기)
2. 대본 작성: `scripts/<같은 slug>.json`
   - 30초 = 2초 × 15컷. 1컷 훅, 2컷 이어받기, 3~13컷 내용, 14~15컷 마무리(행동 유도)
   - 한 줄 12자 안팎, 컷당 2줄 이하. 같은 항목이 이어지면 `label` 유지
   - **원문에 있는 사실만** 쓴다 (가격·기간·구성 등 지어내지 않음)
   - 형식: `{"url", "title", "cuts": [{"text", "label"?}], "caption", "hashtags": []}` (자세한 건 `tools/make_video.py` 의 `load_script`)
3. 커밋·푸시 후 워크플로 실행 `script=scripts/<slug>.json`, 음성 필요 없으면 `narration=음성 없음`
4. 완료 후 `videos/<slug>.mp4` 확인, 컷 화면을 한 장으로 모아 점검하고 사용자에게 보낸다
