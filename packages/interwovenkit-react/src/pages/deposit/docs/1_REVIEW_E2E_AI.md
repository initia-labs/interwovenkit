# E2E 테스트 — AI 자동화

> **개발용 임시 문서.** 개발 중에만 쓰고 구현이 안정화되면 삭제하므로, 코드 주석에서 이 문서를 링크하거나 참조하지 마라.

> AI(Playwright MCP)는 이 checklist로 Deposit API 기반 "Deposit via address"와 "Buy with cash/card"를 검증한다. mock API([mock/README.md](../../../../../../mock/README.md))로 온체인 도착 이후 화면과 checkout도 검증한다. 실결제, 실입금, 실기기는 [1_REVIEW_E2E_HUMAN.md](./1_REVIEW_E2E_HUMAN.md), 화면 state 목록은 [1_REVIEW_E2E_SCREENS.md](./1_REVIEW_E2E_SCREENS.md), 디자인 비교는 [3_REVIEW_DESIGN.md](./3_REVIEW_DESIGN.md) 소관이다. "Deposit via wallet"(Router API, `wallet/`)은 범위 밖이다. 전체 구조는 [0_OVERVIEW.md](./0_OVERVIEW.md), HTTP 규격은 [API_DEPOSIT.md](./API_DEPOSIT.md), Onramper 연동은 [API_ONRAMPER.md](./API_ONRAMPER.md)를 참조한다.

## 구현 현황

두 경로 모두 실데이터 연동이 완료됐다. 공용 `data/`가 asset, deposit address, deposit polling, source metadata를 처리한다. 미설정과 실패는 그대로 오류를 반환하며 method 허브의 가용성 판정만 disabled 상태와 사유로 바꾼다([게이팅 규칙](./0_OVERVIEW.md#flow-ownership)).

## 자동화 범위

과금이 없고 반복 가능한 범위 전부다(조회 GET과 주소 파생뿐이라 과금이 없다). 코드 변경 시 회귀 검증은 이 문서의 절차로 갈음한다.

- **진입/게이팅**: 자산 목록, 단일 denom 스킵, method 허브 가용성 게이팅
- **크립토**: 입금 주소 발급(QR)·Supported network·최소금액 표시, `deposits` 폴링 시작
- **cash**: fiat/결제수단/provider 견적 조회, 소스 매핑, Buy 폼 표시값, Minimum received
- **입력 적대적 드릴**: 아래 [Happy path 밖 케이스](#happy-path-밖-케이스-적대적-드릴)
- **횡단 검증**: 네트워크 계약(메서드·경로·상태코드), 콘솔 에러 0
- **mock API 확장 범위** ([mock 환경](#mock-api-환경-선택) 주입 시): 온체인 도착 이후 화면(추적·처리중/완료/실패/below_minimum 버킷), cash checkout 완주(가짜 결제 페이지), 딜레이·에러 주입 하의 폴링 UI

기능별 자동화 경계와 전용 준비·드릴·함정은 아래 2·3번 섹션에 있다.

### 사람 위임 범위 (자동화 절대 불가)

다음 단계에 도달하면 자동화를 중단하고 [1_REVIEW_E2E_HUMAN.md](./1_REVIEW_E2E_HUMAN.md)에 넘긴다.

- **결제/KYC 완주**: 실카드·실명 KYC가 필요한 프로덕션 스모크
- **실환경 입금 검증**: 실자산 송금이 실제 백엔드 파이프라인(감지·펀딩·브릿지)을 통과하는지 — mock 검증은 프론트 화면·계약까지만 대체한다
- **실기기/실지갑**: 모바일 터치, 확장 지갑, 딥링크

### 탐색적 테스트 (문서 밖 케이스 발견)

이 문서는 완결된 체크리스트가 아니다. 매 세션, 적혀 있는 것만 확인하고 끝내지 말고 화면을 보면서 **적혀 있지 않지만 테스트해볼 만한 것**을 찾으려 노력한다. 새 케이스를 발견하면:

- **자동화 가능하면**: 이 문서의 해당 섹션에 추가하고 즉시 테스트한다.
- **자동화 불가능하면**: [1_REVIEW_E2E_HUMAN.md](./1_REVIEW_E2E_HUMAN.md)의 해당 섹션(없으면 신설)에 항목과 수동 테스트 방법을 기재한다.

## 환경 준비

- **dev 서버**: 예제 앱 `examples/vite`에서 `pnpm dev` (포트 5173). 이미 떠 있으면 재사용한다. env 주입이 필요한 경우는 그 env로 새로 기동해야 하며, 5173 점유 시 Vite가 5174로 띄운다.
- **테스트 지갑**: 커넥터 "Test Wallet"은 `INITIA_TEST_MNEMONIC`이 설정돼야 connect 모달에 뜬다. `.env`에 없으면 throwaway 니모닉을 주입해 기동한다:
  `INITIA_TEST_MNEMONIC="test test test test test test test test test test test junk" pnpm dev`
  인메모리 서명이라 펀드가 필요 없고, 검증 범위(자산 선택, 주소 발급, 폴링, fiat 목록, 견적)는 서명을 하지 않으므로 빈 지갑으로 충분하다.
- **네트워크**: Library의 `depositApiUrl` 기본값은 mainnet에만 존재한다(`public/data/constants.ts` 주석 참조). Example 앱은 network config 이후 Deposit mock URL을 전달하므로 mainnet과 testnet 모두 mock을 사용한다.
- **Deposit API 인스턴스**: mainnet 기본값 `https://deposit-api.initia.xyz`가 현재 `src_decimals`, `has_more` 등 신규 규격을 서빙한다(2026-08-01 확인). Example 앱은 Deposit mock URL `http://localhost:8788`을 항상 사용한다.
- **Shadow DOM**: 위젯은 Shadow DOM에 렌더된다. 셀렉터/스냅샷이 경계를 넘는지 확인한다(a11y 스냅샷은 넘는다).

## mock API 환경 (선택)

실제 자금 없이 온체인 도착 이후 화면과 cash checkout 완주를 테스트하는 환경이다. 서버 계약·컨트롤 API 상세는 [mock/README.md](../../../../../../mock/README.md)를 참조한다.

- **기동**: Deposit mock을 개발 인스턴스를 upstream으로 실행한 뒤 example 앱을 실행한다.

  ```bash
  UPSTREAM_URL=http://34.87.138.107:8080 pnpm --filter @mock/deposit dev
  pnpm dev
  ```

  `examples/vite`는 Deposit mock URL `http://localhost:8788`을 항상 사용하며 내장 MockDevtool은 없다. Onramper 조회의 지연과 오류도 주입하려면 `mock/onramper`를 실행하고 test host의 `InterwovenKitProvider`에 `onramperApiUrl="http://localhost:8789"`를 전달한다. example 앱은 `INITIA_ONRAMPER_API_URL`을 읽지 않는다.

- **가짜 입금 트리거**: QR 화면(또는 Processing 화면)이 폴링 중일 때 아래 호출로 입금을 발생시킨다. `wallet_address`는 연결 지갑, `chain_id`/`asset_denom`은 선택한 destination, `amount`는 소스 base unit이다.

  ```bash
  curl -X POST localhost:8788/__mock/deposits -H 'content-type: application/json' \
    -d '{"wallet_address":"init1…","chain_id":"interwoven-1","asset_denom":"move/…","amount":"100000000"}'
  ```

- **상태 머신**: 생성된 deposit은 3초 간격(`advanceIntervalMs`)으로 `detected → … → completed`를 자동 진행한다. `PATCH /__mock/config`로 `autoAdvance: false`를 주면 `POST /__mock/deposits/{id}/advance`로 한 단계씩 전진하고, `POST /__mock/deposits/{id}/status`(`failed`/`cancelled`)로 실패 화면을, 생성 시 `"status": "below_minimum"`으로 below_minimum 화면을 재현한다.
- **주의 — mock이 검증하는 것**: 프론트 화면·계약(폴링, 버킷 판정, 추적 UI)이다. 백엔드 파이프라인과 실자산 이동은 검증되지 않는다([사람 위임 범위](#사람-위임-범위-자동화-절대-불가)).
- **주의 — checkout 완주의 금액은 근사치다**: mock의 checkout→deposit 변환은 fiat 금액을 소스 크립토 수량으로 1:1 치환한다(`checkout.ts`의 `performCompletion` 주석 참조). 스테이블 자산(iUSD)은 근사가 맞지만 ETH 목적지는 완료 화면에 "100 ETH"처럼 비현실적 금액이 나온다 — mock 제한이지 프론트 버그가 아니다. 완료 금액 표기를 검증할 때는 iUSD로 완주한다.

## 무엇을 테스트하나

섹션 번호는 method 허브의 표시 순서다. "1. Deposit via wallet"(Router API, `wallet/`)은 기존 transfer 플로우라 범위 밖이다.

### 2. Deposit via address

- **화면 흐름**: 자산 선택 → method 허브 → `DepositAddress`(QR) → `DepositTracking`(폴링 추적)
- **자동화 경계**: 실 API 기준 **실입금 도착 전**까지. 새 지갑은 `deposits`가 빈 목록이라 QR 화면에 머무는 것이 정상이고, 추적 화면과 처리중/완료/실패 버킷은 실제 송금 없이 도달할 수 없다(실입금 검증은 [1_REVIEW_E2E_HUMAN.md](./1_REVIEW_E2E_HUMAN.md) 소관). **[mock 환경](#mock-api-환경-선택)에서는 이 경계가 없다**: QR 화면 폴링 중 가짜 입금을 트리거해 감지 → `DepositTracking` 진입 → 자동 진행 → "Transfer complete"까지, 그리고 강제 전이로 실패/below_minimum 화면까지 AI가 검증한다.

#### 테스트 절차와 기대 결과

화면은 a11y 스냅샷으로 확인하고, "네트워크:"로 적은 호출은 `network_requests`로 200을 확인한다.

1. **"Deposit" 버튼을 누른다** → 자산 선택 화면이 뜬다.
   - host가 `openDeposit({ denoms })`로 넘긴 자산만 목록에 보여야 한다.
   - 자산이 하나뿐이면 이 화면 없이 바로 method 허브가 뜨고, back 버튼이 없어야 한다.
2. **목록에서 자산을 누른다** → 다른 화면을 거치지 않고 **바로** method 허브가 뜬다.
   - 세 method가 보여야 한다: "Deposit via wallet"(연결된 지갑 주소·"Your connected wallet" 표시), "Deposit via address"(활성이면 "From any wallet or exchange · No limit" 표시), "Buy with cash/card".
   - "Buy with cash/card"의 설명은 한도 로드 전 "Card or bank transfer"였다가 로드 후 "Up to $X"로 바뀐다(비동기 — 실측 $56,843). 첫 스냅샷에 "Card or bank transfer"가 보여도 회귀가 아니다.
   - `config/assets`에 라우트가 없는 자산이면 뒤의 두 method가 비활성이고 "Not supported for this asset"이 보여야 한다.
   - 네트워크: `config/assets` 200.
3. **"Deposit via address"를 누른다** → 입금 주소 화면이 뜬다.
   - 입금 주소(`deposit_address`)와 QR 코드가 보여야 한다. Source asset과 Supported network가 여러 개면 각각 선택할 수 있어야 한다. Source asset 변경 시 network 목록과 minimum이 해당 route로 바뀌어야 한다.
   - Supported network 셀렉터에 체인별 최소금액("Min 10 USDC")이 보이고, 최소금액·지원자산 경고 문구도 보여야 한다.
   - 네트워크: `deposit-address` 200.
4. **아무것도 하지 않고 기다린다** → QR 화면이 그대로 유지된다.
   - 뒤에서 `deposits`를 첫 5분 동안 약 3초마다 polling하고, 이후에는 15초 간격으로 완화해야 한다.
   - 빈 지갑은 계속 QR 화면에 머무는 것이 정상이다. 입금이 감지된 후에만 추적 화면("Confirming your deposit…")으로 바뀌어야 한다.
   - 네트워크: 첫 5분 동안 `deposits`가 약 3초 간격으로 반복 호출. 5분 이후에는 약 15초 간격.
5. **back으로 나갔다가 다시 들어온다** → 같은 주소가 다시 보인다.
   - 주소는 결정론적이라 매번 같아야 하고, 폴링도 다시 시작돼야 한다.
   - 이 경로엔 텍스트 입력이 없어 그 외 입력 적대적 드릴은 해당 없다.

#### mock 환경 추가 절차 (온체인 도착 이후)

[mock 환경](#mock-api-환경-선택)에서만 수행한다.

6. **QR 화면에서 가짜 입금을 트리거한다** → 다음 폴링(≤3초)에 추적 화면("Confirming your deposit…")으로 전환된다.
7. **아무것도 하지 않고 기다린다** → 상태 머신이 자동 진행되어 Confirming → Transferring → "Transfer complete" 순서로 바뀐다.
   - 각 단계에서 `bucket`이 waiting → processing → completed로 흐르고, 완료 화면 금액은 접두 없는 일반 표기다("≈" 없음 — 표기 우선순위와 근거는 `completedAmount.ts`의 `formatCompletedAmount` JSDoc 참조).
8. **진행 중 back으로 나갔다가 다시 들어온다** → 추적 화면으로 자동 전진하지 않고 QR 화면이 유지되며, "A transfer to this address is in progress" resume 링크가 떠야 한다. 링크 클릭 시 추적 화면으로 진입한다(`useActiveDeposits` 재개 감지 — 자동 전진은 신규 도착 전용).
9. **터미널 분기**: `autoAdvance: false`로 두고 새 가짜 입금 → `POST /__mock/deposits/{id}/status`로 `failed` 강제 전이 → 실패 화면(자금이 주소에 남아 있고 자동 환불 없음 안내). 생성 시 `"status": "below_minimum"` → below_minimum 화면(`required_min_amount` 표시).
10. **재사용 주소 오염 방지**: 완료된 deposit이 있는 주소에서 "Make another transfer"로 QR 화면에 복귀해도 과거 완료 건으로 즉시 추적 화면에 되돌아가지 않아야 한다(mount별 fresh cursor).

### 3. Buy with cash/card

- **화면 흐름**: 자산 선택 → method 허브 → `OnrampFields`(Buy 폼) → 하위 선택(`SelectFiat`/`SelectReceiveChainAsset`/`SelectPaymentMethod`/`SelectProvider`) → `OnrampProcessing`(checkout + redirect, 구매분 도착 감지까지 유지) → `DepositTracking`(크립토와 공용, 감지 후 진입)
- **전용 데이터 레이어**: `onramp/data/` — `onramper`(`onramperApiUrl` 기반 조회 + Deposit API checkout proxy), `minReceived`
- **자동화 경계**: 실 API 기준 **결제 직전**까지 — checkout intent 생성 + provider 결제 페이지 새 탭 + Processing 화면의 감지 폴링 시작까지. 실제 결제/KYC와 온체인 도착 이후는 [1_REVIEW_E2E_HUMAN.md](./1_REVIEW_E2E_HUMAN.md) 소관이다. **[mock 환경](#mock-api-환경-선택)에서는 checkout이 가짜라 완주가 가능하다**: Buy 제출 → mock이 호스팅하는 가짜 결제 페이지 새 탭(`http://localhost:8788/checkout/…` — `assertCheckoutUrl`의 loopback 예외로 통과) → "Complete payment" 클릭 → Processing 화면이 감지 → `DepositTracking` → "Transaction complete"까지 AI가 검증한다. "Fail payment"는 deposit을 만들지 않아 Processing 화면에 머무는 것(fiat 실패 시맨틱)도 함께 확인한다.
- **환경 준비 — Onramper 설정**: MAINNET에 proxy URL과 publishable key가 내장돼 **별도 주입 없이 cash가 기본 활성**이다. example 앱은 Onramper env override를 읽지 않는다. Host override를 검증하거나 게이팅 비활성("Unavailable on this app")을 재현하려면 `InterwovenKitProvider`에 `onramperApiUrl` 또는 `onramperApiKey=""`를 직접 전달한다.

#### 테스트 절차와 기대 결과

화면은 a11y 스냅샷으로 확인하고, "네트워크:"로 적은 호출은 `network_requests`로 200을 확인한다. MAINNET의 Onramper read URL은 `deposit-api.initia.xyz/v1/onramper`다.

1. **method 허브에서 "Buy with cash/card"를 본다** → 활성이어야 한다.
   - 키 주입 없이도 MAINNET 내장 키로 기본 활성이다.
   - `onramperApiKey=""`를 넘겼을 때만 비활성이고 "Unavailable on this app"이 보여야 한다.
2. **"Buy with cash/card"를 누른다** → Buy 폼이 뜬다.
   - Pay에 USD(기본), Receive에 목적지 자산의 심볼/체인이 보여야 한다.
   - Provider, Estimated price, Estimated time, Fee, Minimum received가 보여야 한다. Minimum received는 해석이 끝나기 전까지 "—"다.
   - 네트워크: Deposit API `GET /v1/quote` 200. (router-api `/v2/fungible/route` 직접 호출은 없어야 한다 — 보이면 구버전 번들이다.)
3. **Pay 통화를 누른다** → fiat 선택 화면(`SelectFiat`)이 뜬다.
   - Onramper 전체 통화(약 57개: USD/EUR/KRW 등)가 보여야 하고, 기본 선택은 USD다.
   - 네트워크: `/supported` 200.
4. **결제수단을 누른다** → 결제수단 선택 화면(`SelectPaymentMethod`)이 뜬다.
   - 지금 고른 fiat→소스 자산 쌍에 맞는 payment-types(Credit Card 등)가 보여야 한다.
   - 네트워크: `/supported/payment-types/{fiat}` 200.
5. **amount에 값을 넣는다**(예: `100`, `fill`로 한 번에) → provider별 견적이 뜬다.
   - payout이 가장 큰 provider에 "Best price" 배지가 붙고, 나머지엔 차이%(예: "-1.67%")가 보여야 한다. price/fee도 보여야 한다.
   - **소스 매핑**: 목적지가 아니라 소스를 산다 — `/quotes/usd/{crypto}` URL의 crypto가 iUSD면 `usdc_ethereum`, ETH면 `eth`(native)여야 한다.
   - 네트워크: `/quotes` 200.

#### Happy path 밖 케이스 (적대적 드릴)

AI가 자동으로 수행한다. AI가 작성한 코드는 happy path에서 거의 틀리지 않으므로, 버그는 주로 이 목록에서 나온다. 주 대상은 amount(`NumericInput`)다.

- **빈 값이나 0을 넣는다** → Buy 버튼이 "Enter amount"로 비활성돼야 한다.
- **최소 미만 소액을 넣는다**(예: `1`) → "Minimum purchase with {method} is $X" alert + "Amount out of range" 비활성 버튼이 보이고, Minimum received는 "—"로 유지돼야 한다.
- **매우 큰 값을 넣는다**(예: `99999999`) → "Maximum purchase with {method} is $X" alert + "Amount out of range" 비활성이 보여야 한다. 견적 실패가 크래시나 무한 로딩으로 새면 안 된다.
- **bridge minimum 미만으로 산다** → Onramper 한도와 별개로 config/assets의 `min_deposit_amount`에 걸리면 "This purchase is below the {min} bridge minimum" alert + "Amount too low" 비활성이 보여야 한다. 온램프 결제수단 한도와 브리지 최소금액이 별개 게이트임을 확인하는 케이스다. **주의 — 데이터 의존**: 이 게이트는 config/assets 값에 따라 UI로 재현이 불가능할 수 있다(2026-07 실측 dev 인스턴스: ETH 0.00005 ETH, USDC 0.1 USDC — 결제수단 최소 $5 구매로도 못 내려감). 재현이 안 되면 회귀로 보고하지 말고 `min_deposit_amount` 실값을 먼저 확인하고, 게이트 로직은 `onramp/quote.test.ts` 유닛 테스트로 갈음한다.
- **소수점·선행 0을 넣는다**(`0.000001`, `100.`, `00100`) → 정규화되거나 거부돼야 한다. 실측: fiat 입력은 소수 2자리로 잘리고(`0.000001`→`0.00`), `100.`/`00100`은 입력창에 그대로 남지만 견적은 정상 동작한다. `/quotes`에는 입력 문자열이 전달되지만 checkout payload의 `amount`는 `Number(fiatAmount)`로 변환된 number다.
- **비정형 포맷을 붙여넣는다** → 붙여넣기는 절대 차단되지 않고, NumericFormat 기본 필터(쓸 수 없는 문자를 걸러내고 이어붙임)가 그대로 처리한다. 일반 숫자·콤마 그룹(`1,234.56`)은 손실 없이 붙고 캐럿 위치 splice가 유지돼야 한다. 그 외(`abc`, `1e5`, decimal comma `1234,56`)는 숫자만 남는다(`1e5`→`15`, `1234,56`→`123456` — 정규화하지 않기로 확정한 트레이드오프).
- **Buy를 연타한다** → 제출 직후 버튼이 즉시 비활성(스피너)돼야 한다. 실 API에선 checkout intent가 실제 생성되므로 제출하지 않고 프로덕션 스모크 1회에서만 확인한다([1_REVIEW_E2E_HUMAN.md](./1_REVIEW_E2E_HUMAN.md#결제kyc-단계-테스트-프로덕션-스모크)). **[mock 환경](#mock-api-환경-선택)에서는 반복 제출이 가능하다** — 연타 시 `uuid` 멱등키로 동일 `transaction_id`가 반환되는지(중복 트랜잭션 없음)도 함께 확인한다.
- **Buy 폼에서 back으로 나갔다가 다시 들어온다** → 크래시 없이 동작해야 한다(하위 선택 화면 포함).
- **잔액 0 지갑으로 전체를 반복한다** → 모든 화면이 빈 지갑으로 동작해야 한다(서명 없음 — [환경 준비](#환경-준비) 참조).

#### 검증 기준선(참고)

iUSD 목적지 + USD 100 입력 시 화면에 보여야 하는 값(실시간이라 변동함):

- 받는 양 `99.200000 iUSD`, best provider `Banxa`(99.2), 다음 `Moonpay`(97.54, -1.67%)
- 가격 `1 iUSD ≈ 1.00 USD`, 수수료 `1.97 USD`
- Minimum received는 payout보다 약간 작은 값(Deposit API `GET /v1/quote`의 `min_received`를 그대로 표시한다. route 정책 슬리피지가 이미 적용된 값이며, 0.5%는 고정값이 아니라 config/assets의 `max_slippage_percent`로 iUSD 라우트의 현재 정책값이다)
- 네트워크: `/supported`, `/supported/payment-types/usd?destination=usdc_ethereum`, `/quotes/usd/usdc_ethereum?...`, Deposit API `GET /v1/quote` 모두 200. 콘솔 에러 0.
- 값은 변동해도 **소스 매핑(`usdc_ethereum`)과 200, best 정렬, Minimum received < payout**은 회귀 기준이다.

checkout까지 검증할 때의 기준선(코드 변경 시 cash 회귀 검증에 이 checkout 프록시 200 확인을 포함한다):

- Buy 제출 → `POST /v1/onramper/checkout` 200 + `{transaction_id(ULID), url}` → provider 결제 페이지가 새 탭으로 열린다(자동 열기는 프로그램적 anchor 클릭이라 실패해도 감지되지 않는다).
- Processing 화면에 "If you weren't redirected automatically, continue with {provider}" 수동 링크가 항상 표시되고, 같은 checkout url을 새 탭으로 연다.
- Processing 화면이 유지되고 첫 5분에는 `deposits`를 3초 간격으로 polling한다. 5분 뒤에는 15초로 완화하며 입금 감지 시에만 `DepositTracking`으로 전환한다. 콘솔 에러 0.
- MAINNET 기본 설정에서는 Onramper 조회 GET도 Deposit API의 `/v1/onramper` proxy로 가야 한다. Checkout POST는 `/v1/onramper/checkout`이며 `POST /v1/onramper/sign`이 보이면 구버전 번들이다.

#### 주의사항 (cash 전용)

- **Buy 제출은 실제 Onramper 트랜잭션을 생성한다**: 결제 전까지 과금은 없지만 반복 제출을 자제한다. ([mock 환경](#mock-api-환경-선택)에서는 checkout이 가짜라 해당 없음.)
- **견적은 300ms 디바운스된다**: 타이핑이 멈춘 뒤에야 `/quotes`가 나간다. 테스트 시 amount는 `fill`로 한 번에 채워 호출 시점을 예측 가능하게 유지한다.
- **HMR 세션의 상태 불일치는 fresh load로 재확인한다**: 오래 떠 있던 dev 서버에서 Buy 폼 재진입 시 입력은 빈 표시인데 견적·Buy 버튼이 활성인 불일치가 관측된 적이 있으나, 페이지 새로고침 후에는 재현되지 않았다(입력값 정상 복원). HMR 모듈 교체가 RHF 컨텍스트와 입력 컴포넌트를 어긋나게 만들 수 있다는 게 유력한 설명이다. 상태 불일치를 발견하면 반드시 새로고침 후 재현을 확인한 뒤에만 버그로 보고한다.
- **a11y 스냅샷은 textbox 값을 간헐 생략한다**: Playwright a11y 스냅샷에서 입력창이 비어 보여도 실제 `el.value`는 채워져 있는 경우가 있다(2026-07 실측: provider 선택 후 복귀한 Buy 폼에서 스냅샷은 placeholder만 표시, `evaluate`로 읽은 값은 "100"). "입력은 비었는데 견적 활성" 류의 불일치는 스냅샷만 믿지 말고 `browser_evaluate`로 실값을 확인한 뒤 판정한다 — 위 HMR 관측도 이 아티팩트였을 가능성이 있다.

## 주의사항 (함정)

- **백엔드를 맹신하지 마라 (계약 우선 검증)**: 이 기능은 백엔드(`initia-labs/deposit`)와 병렬 개발 중이라 계약이 자주 바뀐다. ① 진실의 근원은 백엔드 소스(`main`)다 — swagger와 이 문서보다 코드를 우선한다. ② dev 인스턴스는 배포 시점에 따라 코드와 어긋날 수 있다 — 거기서 200이 나도 최신 계약의 증거가 아니다. ③ 예상 밖 실패(`400`/`404`/`405`/`503`)는 먼저 계약 불일치를 의심하고, `network_requests`로 실제 메서드·경로·body 케이싱을 백엔드 소스와 대조한다.
- **하위호환성을 고려하지 마라 (미출시 개발 단계)**: 프론트엔드와 백엔드 모두 아직 한 번도 출시된 적 없는 개발 진행 단계다. 프론트는 백엔드 `main`의 최신 계약 하나만 따르면 되고, 구버전 API 스키마 대응·마이그레이션·릴리스 순서 조율 같은 하위호환성 작업은 불필요하다. 구계약 인스턴스(현 프로덕션 등)에서 나는 에러를 하위호환성 버그로 보고하지 마라.
- **CORS는 반드시 브라우저에서 검증한다**: curl은 preflight를 안 해 통과한다. Deposit API의 허용 헤더 제약은 `data/api.ts` 주석 참조.
- **스크린샷 타임아웃**: 포트폴리오 SSE 스트림 때문에 network-idle에 도달하지 못해 `browser_take_screenshot`이 자주 타임아웃한다. 검증은 a11y `browser_snapshot`으로 하고, 긴 목록은 `target`+`depth`로 부분 스냅샷한다.
- **"buffer externalized" 콘솔 경고는 무시한다**: `Module "buffer" has been externalized for browser compatibility` 경고는 Vite dev 서버가 Node 빌트인을 브라우저용으로 치환하며 내는 것으로, deposit 기능과 무관하고 동작에 영향이 없다. "콘솔 에러 0" 판정에서 제외하고, 이 경고를 회귀로 보고하지 마라.

## 실행 checklist

1. [ ] throwaway 니모닉으로 `pnpm dev`를 실행한다. env를 주입했다면 실제 포트가 5173인지 5174인지 로그에서 확인한다.
2. [ ] Playwright MCP로 dev URL에 이동하고 지갑을 연결한 뒤 "Deposit"을 누른다.
3. [ ] [2번](#2-deposit-via-address)을 순서대로 실행하고 a11y 스냅샷과 `network_requests`를 확인한다.
4. [ ] iUSD를 선택해 [3번](#3-buy-with-cashcard)과 [적대적 드릴](#happy-path-밖-케이스-적대적-드릴)을 실행한다. `/v1/onramper` request를 필터링한다.
5. [ ] [mock 환경](#mock-api-환경-선택)에서 [온체인 도착 이후 절차](#mock-환경-추가-절차-온체인-도착-이후)와 checkout 완주를 실행한다.
6. [ ] 3~5단계에서 탐색적 테스트를 병행하고 새 자동화 사례는 이 문서, 수동 사례는 [1_REVIEW_E2E_HUMAN.md](./1_REVIEW_E2E_HUMAN.md)에 기록한다.
7. [ ] 새로 실행한 dev 서버, mock 서버, 브라우저를 종료한다.
