# Mock API

Deposit API와 Onramper read API의 로컬 mock이다. 실제 송금이나 결제 없이 deposit UI를 테스트한다. 구현 규격은 [DESIGN.md](./DESIGN.md)에 있다.

## 실행

Deposit mock은 현재 production API를 기본 upstream으로 사용한다.

```bash
pnpm --filter @mock/deposit dev
pnpm dev
```

기본 port는 Deposit `8788`, Onramper `8789`다. 다른 upstream이 필요하면 `UPSTREAM_URL`, 다른 port가 필요하면 `PORT`를 서버 실행 시 전달한다.

Onramper의 read 오류와 지연도 주입하려면 별도 서버를 실행한다.

```bash
pnpm --filter @mock/onramper dev
```

`examples/vite`는 Deposit mock URL `http://localhost:8788`을 항상 사용한다. `INITIA_ONRAMPER_API_URL`과 내장 MockDevtool은 없다. Onramper mock을 사용하려면 test host의 `InterwovenKitProvider`에 `onramperApiUrl="http://localhost:8789"`를 전달한다. 설정하지 않으면 MAINNET 기본 read proxy를 사용한다.

## HTTP control

Mock 상태는 `/__mock/*` HTTP endpoint로 조작한다. 이 endpoint에는 지연과 오류를 주입하지 않는다.

```bash
# 자동 진행 중지와 일반 API 지연
curl -X PATCH localhost:8788/__mock/config \
  -H 'content-type: application/json' \
  -d '{"autoAdvance":false,"responseDelayMs":1000}'

# 가짜 입금 생성. amount는 source base unit 문자열이다.
curl -X POST localhost:8788/__mock/deposits \
  -H 'content-type: application/json' \
  -d '{"wallet_address":"init1…","chain_id":"interwoven-1","asset_denom":"move/…","amount":"1000000"}'

# 상태 조회, 한 단계 진행, 실패 전이
curl localhost:8788/__mock/deposits
curl -X POST localhost:8788/__mock/deposits/<id>/advance
curl -X POST localhost:8788/__mock/deposits/<id>/status \
  -H 'content-type: application/json' -d '{"status":"failed"}'

# 모든 deposit, checkout, timer, 설정 초기화
curl -X POST localhost:8788/__mock/reset
```

`below_minimum`은 생성 body에 `"status":"below_minimum"`을 넣어 재현한다. `PATCH /__mock/config`는 `autoAdvance`, `advanceIntervalMs`, `checkoutMode`, `checkoutAutoDelayMs`, `fakeSourceNetwork`, `responseDelayMs`, `errorRate`를 받는다.

Onramper mock은 `responseDelayMs`와 `errorRate`만 지원한다.

```bash
curl -X PATCH localhost:8789/__mock/config \
  -H 'content-type: application/json' \
  -d '{"responseDelayMs":1000,"errorRate":0}'
```

## Test flows

### Via address

QR 화면이 신규 입금을 polling하는 동안 `POST /__mock/deposits`를 호출한다. 위젯은 fresh cursor 이후의 입금을 감지하고 `DepositTracking`으로 전환한다. 이전 진행 중 입금은 자동 전환하지 않고 resume link로 표시한다.

### Cash

Checkout을 시작하면 Deposit mock의 `/checkout/{transactionId}`가 새 tab에 표시된다.

- `Complete payment`는 가짜 deposit을 생성하고 상태 진행을 시작한다.
- `Fail payment`는 deposit을 생성하지 않는다.
- `checkoutMode: "auto"`는 `checkoutAutoDelayMs` 뒤 자동 완료한다.

### Via wallet

지갑 broadcast는 mock하지 않는다. 추적 UI는 via address 절차로 검증한다.

## Endpoint summary

| 서버     | Endpoint                                                                                                                     | 동작                                    |
| -------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Deposit  | `GET /v1/config/assets`, `GET /v1/quote`                                                                                     | Upstream proxy                          |
| Deposit  | `POST /v1/deposit-address`                                                                                                   | 주소 mapping 기록, local cursor 발급    |
| Deposit  | `POST /v1/onramper/checkout`                                                                                                 | 가짜 transaction과 checkout URL 생성    |
| Deposit  | `GET /v1/deposits`, `GET /v1/deposits/{id}`, `GET /v1/deposits/by-source-tx/{tx_hash}`                                       | In-memory deposit 조회                  |
| Onramper | 모든 non-control path                                                                                                        | Authorization을 유지하는 upstream proxy |
| 공통     | `GET/PATCH /__mock/config`                                                                                                   | 설정 조회와 부분 변경                   |
| Deposit  | `GET/POST /__mock/deposits`, `POST /__mock/deposits/{id}/advance`, `POST /__mock/deposits/{id}/status`, `POST /__mock/reset` | 시뮬레이션 제어                         |

## Limits

두 서버는 Hono와 `@hono/node-server`를 사용하며 Node 24에서 TypeScript를 직접 실행한다. State는 process memory에만 있고 restart하면 초기화된다. Rate limit, 실제 환율, wallet broadcast, fiat transaction 조회, webhook, SSE, 원격 배포는 구현하지 않는다. 세부 제한은 [DESIGN.md](./DESIGN.md#충실도-한계)를 참조한다.
