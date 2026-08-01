# Deposit API reference

> **개발용 임시 문서.** 개발 중에만 쓰고 구현이 안정화되면 삭제하므로, 코드 주석에서 이 문서를 링크하거나 참조하지 마라.

> HTTP API `Deposit API` v0.1.0 reference. 프론트엔드 개요는 [0_OVERVIEW.md](./0_OVERVIEW.md), 인프라는 `github:initia-labs/deposit`의 `docs/md/architecture.md`, Onramper는 [API_ONRAMPER.md](./API_ONRAMPER.md)를 참조한다.

- **출처**: 백엔드 소스(`github:initia-labs/deposit`, `main`)가 1차 근거이고 OpenAPI 문서(`/swagger/doc.json`)와 라이브 실측이 보조다. 코드와 swagger가 다르면 코드를 따른다(swagger는 수기 유지보수라 일부 스키마가 비어 있다).
- **인스턴스**: 프로덕션(mainnet 코드 기본값) `https://deposit-api.initia.xyz`, 개발 `http://34.87.138.107:8080`(평문 HTTP라 HTTPS 페이지에서 mixed-content 차단 — 로컬 개발 전용). base URL은 설정에서 주입하고 코드에 하드코딩하지 않는다. admin 토큰 등 운영 설정은 코드 기본값과 다를 수 있다.

## 규약

- `chain_id` 및 `*_chain_id`는 Router 또는 Initia 형식 문자열이다. EVM 소스는 숫자 문자열(`"1"` = Ethereum), Initia L1은 `interwoven-1`, 롤업은 `yominet-1`, `civitia-1` 등이다.
- 모든 금액 필드는 정수 기본 단위(base unit) 문자열이다. decimals는 자산/네트워크마다 다르므로(같은 iUSD라도 move 6, EVM 18) 표시 시 해당 `decimals`로 변환한다.
- 타임스탬프는 ISO 8601(RFC 3339) 문자열, `id`는 UUID 문자열이다.
- 에러 응답은 모든 비 2xx에서 `{ "error": "<message>" }`다. 모든 엔드포인트가 `413`(본문 크기 초과)/`429`(레이트리밋)를 낼 수 있다.
- `wallet_address`는 init bech32 또는 `0x` EVM hex 입력을 받고, canonical init bech32(소문자)로 정규화되어 저장·반환된다.
- 응답의 모든 `0x` EVM 주소(`deposit_address` 등)는 EIP-55 체크섬 casing으로 정규화되어 반환된다. `deposit_address` 필터 입력은 대소문자 무시로 매칭된다.

## 인증과 CORS

- **공개 엔드포인트**(health, `config/assets`, deposits 조회, `deposit-address`, `onramper/checkout`)는 무인증이다. CORS는 전면 개방: `Access-Control-Allow-Origin: *`, 메서드 `GET, POST, OPTIONS`, 허용 헤더 `Authorization, Content-Type, X-Correlation-ID, X-Request-ID`. **그 외 커스텀 헤더는 preflight에서 차단된다**(프론트 대응은 `data/api.ts` 주석 참조).
- Process-local rate limiter는 `API_RATE_LIMIT_PER_MINUTE`로 설정하며 기본값 `0`은 비활성이다. 현재 구현은 `RemoteAddr`를 기준으로 하므로 load balancer 뒤에서 활성화하기 전에 trusted proxy 처리가 필요하다.
- `/v1/admin/*`, `/v1/ops/metrics`, Prometheus `/metrics`는 프론트 미사용(운영/관측용)이다. admin은 Bearer 공유 토큰이며 토큰 미설정 시 404로 은폐된다. 상세는 백엔드 소스와 인증된 `/swagger/admin`을 본다.

## Endpoint reference

### GET `/health`, GET `/health/ready`

라이브니스/레디니스 probe. 프론트 미사용.

### GET `/v1/config/assets`

지원 소스 route와 목적지 asset 목록. **응답 `200`**: `{ "assets": Asset[] }`

```json
{
  "assets": [
    {
      "src_chain_id": "1",
      "src_denom": "ethereum-native",
      "src_decimals": 18,
      "min_deposit_amount": "5000000000000000000",
      "max_slippage_percent": "0.0",
      "dst_symbol": "ETH",
      "dst_networks": [
        {
          "chain_id": "interwoven-1",
          "chain_name": "initia",
          "denom": "move/edfcdd…f954",
          "decimals": 6,
          "vm_type": "move",
          "processing_time_seconds": 300
        }
      ]
    }
  ]
}
```

- `src_chain_id`/`src_denom`은 **Router(Skip) 식별자와 의도적으로 동일**하다(네이티브는 `"ethereum-native"`, ERC-20은 체크섬 컨트랙트 주소). 소스 심볼/로고 필드는 없으므로 프론트는 Router 메타데이터에서 해석한다.
- `min_deposit_amount`는 **소스 denom 기본 단위**다(포맷은 `src_decimals` 기준). 라우트별 백엔드 설정값(`DefaultRoutes` 폴백, `ROUTES_JSON` env 오버라이드)이라 변경될 수 있고, 한 라우트의 min은 모든 `dst_networks`에 공통 적용된다. 비스테이블 소스(ETH 등)는 USD 환산 없이 토큰 수량과 심볼을 그대로 표시한다(소스 가격 피드는 두지 않는다).
- `max_slippage_percent`는 이 라우트의 **백엔드 정책 슬리피지**(percent 문자열, 스왑 없는 라우트는 `"0.0"`)다. 사용자 설정이 아니다.
- `dst_networks[].processing_time_seconds`는 **optional**이다. 백엔드가 router-api 라우트 견적으로 계산해(L2 목적지는 IBC hop +30초) 1분 TTL 서버 캐시로 제공하며, 캐시 미스 시 백그라운드 갱신을 시작하고 필드 없이 먼저 응답한다 — 콜드 캐시의 첫 응답에 필드가 빠지고 몇 초 뒤 응답엔 값이 있는 것이 정상이다. router-api가 timeout(10초)으로 응답하지 못하면 계속 생략된다. 부재는 0이 아니라 "알 수 없음"으로 다룬다.
- **서비스 수수료가 없고 운영자가 가스를 스폰서한다("for now" 정책).** 입금 `amount`가 Router에 `amount_in`으로 그대로 전달되고 **순 수령액 = Router `amount_out`**(스왑 라우트는 슬리피지 반영). 최소 수령액 표시는 [`GET /v1/quote`](#get-v1quote)를 사용한다.

### POST `/v1/deposit-address`

`(wallet_address, 목적지 chain_id, 목적지 asset_denom)`에 대한 결정론적 입금 주소를 생성하거나 반환한다. 알 수 없는 필드가 있으면 `400 {"error":"invalid request body"}`.

```json
{
  "wallet_address": "init1zyg3…30th3ed",
  "chain_id": "interwoven-1",
  "asset_denom": "move/6c6973…b570e"
}
```

**응답** `200`: 요청 필드 + `"deposit_address": "0x3aC0C2…C953"` + `"cursor": "v1.…"`

- HD 파생은 정확히 세 입력만 해싱한다. 같은 wallet이라도 목적지가 다르면 다른 주소가 나오고, DB 유일성도 `(wallet_address, dst_chain_id, dst_denom)`이다. checkout 프록시도 이 파생을 재사용한다.
- 소스가 EVM이므로 `deposit_address`는 `0x` hex이며, EIP-55 체크섬 casing으로 반환된다.
- **소스 체인/자산은 파라미터가 아니다.** 주소는 목적지로만 keyed되어 모든 지원 소스 자산을 수신하며, 라우트는 감지 시점에 전송의 `(src_chain_id, src_denom)`으로 결정된다. **지원되지 않는 소스 자산**을 보내면 매칭 라우트가 없어 레코드가 생성되지 않고 자금이 묶인다(의도된 동작, 자동 환불 없음) — 프론트는 지원 자산만 보내도록 경고해야 한다.
- `deposit_id`를 반환하지 않으므로 송금 후 추적은 별도 발견 단계가 필요하다([입금 발견과 폴링](#입금-발견과-폴링)).
- `cursor`는 응답 시점의 DB 시계 기준 watermark를 담은 opaque 문자열(`v1.` + base64url JSON)이다. `GET /v1/deposits`의 `after`로 되돌려 보내면 이 응답 이후에 생성된 입금만 받는다 — "새 입금 판별"이 서버 시계만으로 이뤄져 클라이언트 시계 skew가 없다. 매 요청마다 새로 발급된다(주소는 결정론적이라 동일해도 cursor는 달라진다).

### POST `/v1/onramper/checkout`

현금/카드(Onramper) checkout 프록시. Onramper `/checkout/intent`가 서버측 전용이므로([API_ONRAMPER.md](./API_ONRAMPER.md#checkout-프록시)) 서버가 입금 주소 재파생 → HMAC 서명 → Onramper checkout 호출까지 수행하고 결제 핸드오프를 반환한다.

**요청** (snake_case JSON body): destination triple(`deposit-address`와 동일) + checkout 필드. 실측 payload:

```json
{
  "wallet_address": "init1veaum7vy45fzw5x4mflskgx5lnmwmxx5wm3x8p",
  "chain_id": "interwoven-1",
  "asset_denom": "move/6c69733a9e722f3660afb524f89fce957801fa7e4408b8ef8fe89db9627b570e",
  "onramp": "banxa",
  "fiat": "usd",
  "crypto": "usdc_ethereum",
  "network": "ethereum",
  "amount": 100,
  "payment_method": "creditcard",
  "uuid": "c4efdd02-e956-49a3-9c55-777c2c8288ce"
}
```

**응답** `200`: `{ "transaction_id": string, "url": string }`. `url`은 provider의 호스티드 결제/KYC 페이지, `transaction_id`는 Onramper transaction id(ULID)다.

- 프론트는 typed checkout input을 명시적인 snake_case JSON으로 변환한다. 백엔드는 `fiat`→`source`, `crypto`→`destination`, `payment_method`→`paymentMethod`로 매핑하고 `type: "buy"`를 고정한다. Onramper의 `source`/`destination` 명칭이 목적지 triple과 충돌해 quotes 어휘(`fiat`/`crypto`)로 대체했다. provider 선택과 견적은 프론트 소관이므로 백엔드는 재계산하지 않고 존재와 타입을 검증한다.
- `uuid`는 프론트 생성 멱등키로 Onramper에 그대로 전달한다(재시도 간 재사용되므로 중복 트랜잭션이 생기지 않는다).
- 서명 오라클을 막기 위해 클라이언트가 보낸 주소가 아니라 서버가 재파생한 `deposit_address`에만 서명한다([API_ONRAMPER.md 서명](./API_ONRAMPER.md#서명-백엔드-참고)).
- 서명 시크릿(`ONRAMPER_SIGNING_SECRET`) 미설정 시 `503`, Onramper 에러는 `{ "error": "<message>" }`로 전달한다.

> sign-only 엔드포인트 `POST /v1/onramper/sign`은 백엔드에서 제거됐다(서버 테스트가 stale 라우트로 `404`를 보증한다). network에 이 호출이 보이면 구버전 번들이다.

### GET `/v1/quote`

사전 견적. 쿼리 파라미터 5개가 모두 필수: `src_chain_id`, `src_denom`, `dst_chain_id`, `dst_denom`, `amount_in`(소스 base unit 양의 정수). **응답** `200`:

```json
{ "amount_out": "99989421", "min_received": "99489473" }
```

- 백엔드가 자체 설정(routes, operational pause, `min_deposit_amount`)으로 라우트를 검증한 뒤 bridge planning과 동일한 router `/route` 호출로 견적한다. `min_received` = `amount_out`에 라우트 정책 슬리피지(`max_slippage_percent`)를 적용해 내림한 값(둘 다 destination base unit). 프론트가 router-api를 직접 미러링하던 계산이 이것으로 대체됐다(정책 드리프트·직접 의존 제거).
- **에러**: 미지원 라우트/pause 중 → `400 "unsupported route"`, 최소 미만 → `400 "amount_in is below min_deposit_amount"`(min 미만은 의도적으로 견적하지 않는다), router가 라우트를 거부(4xx) → `400 "route is unavailable"`, router 실패 → `502 "failed to quote route"`, quote router 미설정 배포 → `503`.

### GET `/v1/deposits`

지갑 또는 입금 주소의 최근 입금 목록. **응답** `200`: `{ "wallet_address"?, "deposit_address"?, "status"?, "active"?, "after_or_active"?, "deposits": Deposit[], "has_more": bool, "next_cursor"? }`(보낸 필터를 echo)

- `wallet_address` 또는 `deposit_address` 중 **최소 하나 필수**. `deposit_address`는 유효한 `0x` EVM 주소여야 하고 대소문자 무시로 매칭된다(`lower()` 인덱스).
- `deposit_address`로 조회 시: 발급된 주소인데 입금이 없으면 `200` + 빈 목록, **발급된 적 없는 주소면 `404 "deposit not found"`**. 둘 다 보냈는데 주소가 그 지갑 소유가 아니면 `400`. (두 판정 모두 결과가 빈 목록일 때만 수행된다 — 입금이 있으면 발급된 주소다.)
- `status`: 선택, `DepositStatus` 단일 값 필터. `active`(선택 boolean)와 **상호 배타**: `true` = 비종단, `false` = 종단(`{completed, failed, cancelled, below_minimum}`).
- `limit`: 선택, 1-100, 기본 50 (100 초과는 에러가 아니라 100으로 클램프).
- `after`: 선택, 서버 발급 opaque 커서([`POST /v1/deposit-address`](#post-v1deposit-address)의 `cursor` 또는 이 응답의 `next_cursor`). watermark 이후에 생성된 입금만 반환한다. 형식 오류·DB 시계보다 미래의 watermark는 `400 "after is invalid"`.
- `after_or_active`: 선택 boolean, **합집합 필터**. true면 "`after` 이후 생성 **또는** 비종단"인 입금을 반환한다. `after` 없이는 `400 "after_or_active requires after"`(단독이면 기존 `active=true`와 중복이라 의도적으로 거절), `status`/`active`와는 상호 배타(`400 "after_or_active cannot be combined with active or status"`). **현재 프론트 소비자는 없다**: 합집합 감지는 이전 세션의 진행 중 입금까지 자동 전진시켜 새 입금 의도를 납치하므로, advance 화면 감지는 `after` 단독 폴링(`useNewDeposits`, 신규 도착만 자동 전진)과 `active=true` 폴링("transfer in progress" resume 링크, `useActiveDeposits`)으로 분리됐다. **제거를 제안한 상태다**(`watch` 리소스 제안에 포함, [후속 항목](#후속-항목) 참조). 출처: `initia-labs/deposit#37`(main 머지 완료, 커밋 `f6fc1eb`).
- **페이지네이션**: 내부적으로 `limit+1`개를 조회해 `has_more`를 판정하고, 더 있으면 마지막 행을 exclusive 경계로 담은 `next_cursor`를 발급한다(`after`로 되돌려 보내면 다음 내림차순 페이지). 프론트는 현재 미사용 — 주소별 발견 폴링은 limit에 한참 못 미친다.

### GET `/v1/deposits/{id}`

단일 입금의 전체 상태. **응답** `200`: `Deposit` / `404`. `bot_tx_hash`/`bot_tx_explorer_url`로 브릿지 tx 링크를 노출할 수 있다.

### GET `/v1/deposits/transitions/{id}`

상태 전이 감사 추적. 프론트 미사용(운영 triage용). `occurrence_count > 1`은 재시도 루프 전이가 합쳐진 것이고, 전이별 `reason` 사유 코드의 전체 목록은 백엔드 소스를 본다.

### GET `/v1/deposits/by-source-tx/{tx_hash}`

소스 트랜잭션 하나에 대응하는 유일한 입금. `src_chain_id` 쿼리 필수(tx 해시는 체인 간 유일하지 않다). **응답** `200`: `Deposit` / `404`.

- 유일성은 DB 유니크 인덱스 `(src_chain_id, src_tx_hash)`로 보장된다. **소스 tx당 입금은 정확히 1건**이며, 한 tx에 여러 입금 로그가 있어도 첫 로그만 기록된다(의도된 규칙).

## 입금 발견과 폴링

주소 발급은 `deposit_id`를 주지 않는다. 송금 후 입금을 찾는 경로:

1. **주 진입점**: `GET /v1/deposits/by-source-tx/{tx_hash}?src_chain_id=`. 클라이언트가 소스 tx 해시를 보유할 때 가장 정확하다. (프론트 미사용 — 수동 전송은 tx 해시가 없다.)
2. **advance 화면 감지**: `deposit_address` + `after`(주소 발급 응답의 `cursor`, mount마다 재발급, `data/depositAddress.ts`의 `useFreshDepositAddress`) + `limit=1`로 cursor 이후 신규 입금을 찾는다(`useNewDeposits`). 결과가 있으면 해당 ID를 저장하고 추적 화면으로 전환한다. 이전 session의 진행 중 입금은 별도 `active=true` poll(`useActiveDeposits`)이 resume link로 노출한다. 자동 전환은 신규 도착에만 적용한다.
3. **추적 화면**: 감지 또는 resume에서 받은 정확한 ID로 `GET /v1/deposits/{id}`를 polling한다. 주소가 일치하는지 다시 확인하고 terminal bucket에서 중단한다.

- **푸시 없음**: webhook/SSE 없이 폴링 전용이다.
- 입금 레코드는 인덱서가 소스 체인의 **finalized 블록**을 관측한 뒤에야 생성된다. 그 전까지 `by-source-tx`는 `404`를 주므로 404는 "아직 대기 중"이다.
- 서버 스캔 루프는 5초 간격이다. 클라이언트의 신규 감지와 detail poll은 화면 진입 후 5분까지 3초, 이후 15초 간격이다. Active resume poll은 처음부터 15초 간격이다.

## Schema reference

### Deposit

```
id                     uuid
src_chain_id           string
src_tx_hash            string
src_log_index          int64
src_denom              string
amount                 string      // 정수 기본 단위
amount_out             string?     // bridge planning 시점 router 견적 (아래 주의)
deposit_address        string      // EIP-55 체크섬 0x hex
wallet_address         string      // 정규화된 init bech32 (소문자)
dst_chain_id           string
dst_denom              string
dst_address            string      // v1에선 wallet_address와 동일 (아래 주의)
observed_height        int64
observed_at            datetime
status                 DepositStatus
bucket                 string      // 서버 계산 사용자용 그룹 (아래 주의)
status_reason          string?     // "below_minimum" 또는 빈 문자열 뿐
required_min_amount    string?     // status=below_minimum일 때 라우트 최소 스냅샷
status_updated_at      datetime
last_transition_actor  string?
last_transition_reason string?     // 머신 판독 사유 코드
last_correlation_id    string?
created_at             datetime
updated_at             datetime
bot_tx_hash            string      // 최신 브릿지 tx 해시, 제출 전 빈 문자열
bot_tx_explorer_url    string      // 위 tx의 익스플로러 URL, 제출 전 빈 문자열
```

- **`dst_address` 주의**: v1에선 목적지 VM 타입과 무관하게 정규화된 init bech32가 그대로 들어간다. 이 bech32가 Router/Skip의 최종 수령자로 전달되며, Router API가 MiniEVM에서 init bech32를 지원하므로 문제없다(백엔드 확인).
- **`amount_out` 주의**: bridge planning이 router에 견적을 요청한 시점의 `amount_out` 스냅샷(destination base unit)이다. **실측 수령액이 아니라 견적치**라 실제 전달은 슬리피지 범위 안에서 달라질 수 있고, planning 이전(대기 status, `below_minimum`, planning 전 실패)에는 없다. 프론트 완료 문구는 "≈" 접두로 표기한다(`completedAmount.ts`의 `formatCompletedAmount`, `DepositTracking.tsx`가 호출).
- **`bucket` 주의**: `status`를 서버가 안정된 5분류(`waiting`/`processing`/`completed`/`failed`/`below_minimum`)로 매핑한 사용자용 그룹이다. 서버가 미래에 추가하는 status도 항상 이 집합으로 매핑되므로(내부 fail-closed: unknown → `failed`), **클라이언트는 화면 선택과 터미널 판정을 `bucket`에 걸고 `status`는 불투명하게 다룬다**. 프론트는 bucket을 boundary에서 검증하지 않고 fail-closed로 다룬다(`data/deposits.ts`: 미지 bucket은 `isTerminalBucket`이 터미널로 계산해 폴링을 멈추고, `displayBucket`이 failed 화면으로 렌더링한다).

### Asset / DestinationNetwork / DepositStatus

프론트 타입(`data/types.ts`)이 필드별 주석과 함께 미러링한다. `processing_time_seconds`만 optional이고 나머지는 required다. 상세 status enum은 `bucket` 채택으로 프론트 타입에서 제거됐다(`status`는 opaque string).

## Lifecycle

`accepted` 이후 입금 금액 밴드에 따라 **instant advance 고속 경로** 또는 **일반 2단계 경로**로 분기한다.

```
detected → accepted
  # 금액 밴드 분기 (min_deposit_amount, advance_max_amount 기준)
  # (A) instant advance (min ≤ amt < advance_max, ADVANCE_ENABLED일 때만)
  → advance_pending → advance_submitting → advance_submitted → completed
     (advance_waiting: 트레저리 풀 부족 시 대기 후 advance_pending 재진입)
  # (B) 일반 브릿지 (amt ≥ advance_max, 또는 advance 비활성)
  → funding_planned → funding_submitting → funding_submitted → funded   // (1) 입금 주소 가스 충전
  → bridge_planned  → bridge_submitting  → bridge_submitted             // (2) 실제 브릿지/릴레이
  → completed
종단 분기: failed, cancelled, below_minimum
```

- `advance_max_amount`는 operator 전용 라우트 설정으로 공개 API에 노출되지 않는다. advance 경로는 백엔드 kill-switch(`ADVANCE_ENABLED`, 기본 off)로 현재 비활성이나 상태값 자체는 wire에서 유효하다.
- **종단 상태 = `{completed, failed, cancelled, below_minimum}`**(`active` 필터와 동일 분할). `below_minimum`은 생성 시점에만 도달하며 `status_reason` + `required_min_amount`가 세팅된다.
- 사용자 표시 분류는 응답의 `bucket` 필드가 담당한다([데이터 스키마의 `bucket` 주의](#deposit)). 프론트의 status→버킷 로컬 매핑은 제거됐다.

### 환불 정책

v1은 자동·수동 환불을 제공하지 않기로 확정했다. `below_minimum`/`failed`/`cancelled` 자금은 입금 주소에 남고 sweep/drain하지 않는다. 운영자가 외부 절차로 회수한다. 현재 위젯에는 support channel 설정이 없어 프론트는 존재하지 않는 연락처로 안내하지 않고 자금 상태와 자동 환불 부재만 표시한다.

## 후속 항목

- **세션 인지 감지 개선(백엔드에 제안, 승인 대기)**: (1) checkout 영속화 + Onramper webhook + `GET /v1/checkouts/{id}` — checkout이 first-class intent가 되고, 지급 tx hash와 `deposits.src_tx_hash` natural key 조인으로 deposit이 checkout에 링크되어 cash 경로가 정확 귀속된다. (2) `GET /v1/deposits/watch` — `{new_deposits, active_deposits, cursor}` 단일 응답으로 현행 `after`/`active` 2폴링을 대체하고, cursor를 응답에서 재발급하며, `after_or_active`를 제거한다. (3) 선택: `deposit_state_transitions` 기반 SSE(`GET /v1/deposits/stream`). 배포 전까지 이 문서의 현재 API 규격이 유효하다.
- **프로덕션 롤아웃**: `https://deposit-api.initia.xyz`가 `src_decimals`와 pagination field를 포함한 신규 규격을 서빙하는 것을 2026-08-01 확인했다. Cursor 발급, `active` filter, lifecycle 전체는 출시 검증 절차에서 계속 확인한다.
- **HTTPS 도메인**: 프로덕션은 HTTPS다. 평문 HTTP 개발 instance는 HTTPS page에서 mixed-content로 차단되므로 로컬 검증에만 사용한다.
- **Polling backoff**: 신규 감지와 detail은 첫 5분 3초, 이후 15초다. Active resume 조회는 처음부터 15초다.
