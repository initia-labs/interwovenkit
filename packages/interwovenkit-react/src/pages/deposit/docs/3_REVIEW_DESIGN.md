# 디자인 리뷰

> **개발용 임시 문서.** 개발 중에만 쓰고 구현이 안정화되면 삭제하므로, 코드 주석에서 이 문서를 링크하거나 참조하지 마라.

> 기능 검증([1_REVIEW_E2E_AI.md](./1_REVIEW_E2E_AI.md), [1_REVIEW_E2E_HUMAN.md](./1_REVIEW_E2E_HUMAN.md))과 코드 리뷰([2_REVIEW_CODE.md](./2_REVIEW_CODE.md))를 마친 뒤 사람이 디자인을 검토한다. 재현할 화면 state는 [1_REVIEW_E2E_SCREENS.md](./1_REVIEW_E2E_SCREENS.md)를 따른다.

## 검토 checklist

- [ ] 색과 간격이 하드코딩되지 않고 디자인 토큰을 사용하는지 확인한다.
- [ ] 모든 state를 라이트모드, 다크모드, 반응형에서 비교한다.
- [ ] 시안에 없는 로딩과 에러 state가 디자이너 의도에 맞는지 확인한다.
- [ ] 포커스 링, 트랜지션, 터치 타겟을 직접 조작해 확인한다.
- [ ] 아래 함정을 적용한 뒤 확정된 차이만 버그로 기록한다.

## 판정 함정

- **시각 비교는 사람 눈이 기준이다.** a11y 스냅샷은 텍스트/구조만 보고, 포트폴리오 SSE 스트림 때문에 스크린샷 자동화도 불안정하다([1_REVIEW_E2E_AI.md 주의사항](./1_REVIEW_E2E_AI.md#주의사항-함정)).
- **화면의 존재와 개수는 시안의 렌더링된 heading 텍스트로 판정한다.** 시안 파일의 레이어/프레임 이름은 판정 기준이 아니다.
- **미확정 시안을 먼저 걸러낸다.** failed/below_minimum 프레임, History, 한도 표기 문구는 확정 여부가 불명확하다. 확정 전 프레임과의 차이는 버그가 아니다.
- **시안에 없는 요소**: Processing 화면의 "If you weren't redirected automatically, continue with {provider}" 수동 링크는 디자인 리뷰(EXP-874)를 사후로 돌리고 먼저 구현했다. 시안과의 차이가 아니라 이 리뷰에서 카피·배치를 확정할 대상이다.
