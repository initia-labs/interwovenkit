# Onramper API reference

> **개발용 임시 문서.** 개발 중에만 쓰고 구현이 안정화되면 삭제하므로, 코드 주석에서 이 문서를 링크하거나 참조하지 마라.

> 조회는 `onramperApiUrl`, checkout은 Deposit API의 `POST /v1/onramper/checkout`을 사용한다. MAINNET의 조회 URL은 Deposit API read proxy다. Onramper 공식 문서와 실측을 기준으로 하며 전체 색인은 [llms.txt](https://docs.onramper.com/llms.txt), 프록시 규격은 [API_DEPOSIT.md](./API_DEPOSIT.md#post-v1onrampercheckout)를 참조한다.

## Integration model

Onramper는 Initia rollup과 iUSD를 직접 지원하지 않는다. Checkout `wallet.address`에 Deposit API 입금 주소를 넣어 `fiat → Ethereum USDC/ETH → Deposit API → 목적지`로 전달한다. 목적지 추적은 crypto 경로와 같은 `DepositTracking`을 사용한다.

## Endpoint reference

- Client base URL: MAINNET 기본값 `https://deposit-api.initia.xyz/v1/onramper`, Onramper prod `https://api.onramper.com/`, sandbox `https://api-stg.onramper.com/`. Host가 `onramperApiUrl`을 직접 API나 mock으로 교체할 수 있다. sandbox 자격증명은 발급이 거절돼 실사용 가능한 외부 환경은 prod뿐이다([1_REVIEW_E2E_HUMAN.md](./1_REVIEW_E2E_HUMAN.md#결제kyc-단계-테스트-프로덕션-스모크)).
- 인증: `Authorization: <API_KEY>` 헤더(raw, `Bearer` 접두사 없음). 프론트는 publishable(`pk_`) 키만 사용하고 secret(`sk_`) 키는 번들하지 않는다. Onramper read API 자체는 CORS를 개방하지만 MAINNET 요청은 기본적으로 Deposit API proxy를 통과한다.
- 호출 순서(공식 권장): supported → payment-types → quotes → checkout/intent. [Integration Steps](https://docs.onramper.com/docs/integration-steps-1.md) 참조.

| 엔드포인트                                                     | 용도                                   |
| -------------------------------------------------------------- | -------------------------------------- |
| `GET /supported?type=buy`                                      | fiat/crypto 목록                       |
| `GET /supported/onramps/all?type=buy`                          | provider 메타데이터 (displayName/icon) |
| `GET /supported/defaults/all?type=buy`                         | 국가별 기본 fiat                       |
| `GET /supported/payment-types/{source}?destination=&type=buy`  | 통화 쌍별 결제수단                     |
| `GET /quotes/{fiat}/{crypto}?amount=&paymentMethod=&type=buy`  | 프로바이더별 실시간 견적 배열          |
| `POST /checkout/intent` (서버측 전용, Deposit API 프록시 경유) | 트랜잭션 개시, 결제 url 반환           |
| `GET /transactions/{id}` (서버측 전용)                         | 트랜잭션 상태 (+ webhook)              |

레퍼런스(`.md`): [Currencies](https://docs.onramper.com/reference/get_supported.md), [Assets](https://docs.onramper.com/reference/get_supported-assets.md), [Defaults](https://docs.onramper.com/reference/get_supported-defaults-all.md), [Onramp Metadata](https://docs.onramper.com/reference/get_supported-onramps-all.md), [Payments by source](https://docs.onramper.com/reference/get_supported-payment-types-source.md), [Get Buy Quotes](https://docs.onramper.com/reference/get_quotes-fiat-crypto.md), [Initiate a Transaction](https://docs.onramper.com/reference/post_checkout-intent.md), [Get Transaction](https://docs.onramper.com/reference/get_transactions-transactionid.md).

응답/타입의 세부는 코드(`onramp/data/onramperTypes.ts`)가 1차 자료다. 프론트는 `country`와 quote의 `walletAddress`를 보내지 않는다(`onramp/data/onramper.ts`).

## checkout 프록시

`POST /checkout/intent`는 **서버측 전용**이다. Onramper 공식 확인(support 답변) — 재문의 방지용 기록:

1. **by design**: 브라우저 컨텍스트에서 직접 호출하도록 의도된 엔드포인트가 아니며, CORS preflight 차단은 오설정이 아니라 의도된 동작이다. (실측: `/quotes`는 ACAO `*` 개방이지만 `/checkout/intent`는 Onramper 엣지가 관리하는 per-origin credentialed allowlist라 자체 위젯 origin `buy.onramper.com`만 반사되고 다른 origin엔 ACAO가 없다. 키/서명/헤더 문제가 아니라 origin이 판정 기준이다.)
2. **origin allowlist가 존재하지 않는다**: 도메인을 추가해줄 방법 자체가 없다. 브라우저에서 checkout을 개시하는 유일한 지원 경로는 호스티드 위젯이다.
3. **커스텀 checkout UI의 권장 패턴은 server-to-server**: `/checkout/intent`는 파트너 백엔드에서 호출해야 한다. rate limit은 표준 기본값이며 예상 트래픽을 공유하면 조정 가능하다.

따라서 Deposit API가 **입금 주소 재파생 → HMAC 서명 → Onramper checkout 호출**을 서버에서 수행하고, 프론트는 `POST /v1/onramper/checkout` 한 호출로 `{ transaction_id, url }`을 받아 **새 탭으로 핸드오프한다**(현재 탭 이동은 위젯을 언마운트시켜 추적 화면 복귀 경로를 없애므로 배제, 팝업 차단 시 수동 continue 링크). 프록시 계약과 payload는 [API_DEPOSIT.md](./API_DEPOSIT.md#post-v1onrampercheckout), 프론트 동작은 코드(`onramp/data/onramper.ts`, `onramp/OnrampProcessing.tsx`) 참조.

제안된 후속(백엔드 승인 대기): 프록시가 checkout을 영속화하고(Onramper `transaction_id` 저장, 클라이언트 `uuid`가 idempotency key) Onramper webhook으로 상태를 수신해 도착한 deposit과 링크하며, 프론트는 `GET /v1/checkouts/{id}` 단건 폴링으로 구매 생애주기를 추적하게 된다. 계약 추적은 [API_DEPOSIT.md 후속 항목](./API_DEPOSIT.md#후속-항목) 참조.

### 서명 (백엔드 참고)

- **signContent 포맷**: 서명 대상 필드를 알파벳순 정렬, URL 인코딩 후 `&`로 join하고 HMAC-SHA256(secret key)으로 hex 서명한다. `signContent`와 `signature`를 둘 다 checkout body에 넣는다. 우리는 `walletAddress`(deposit address, `0x` EVM, memo 없음) 한 필드뿐이라 `walletAddress=0x...`이 전부다.
- **서명 오라클 방지**: deposit address는 `(wallet_address, chain_id, asset_denom)`으로 결정론적이므로 Deposit API가 재파생해 그것에만 서명한다. 클라이언트가 보낸 주소나 문자열을 그대로 서명하면 임의 주소로 자금을 빼돌릴 수 있다.

```js
import { createHmac } from "node:crypto"
const signContent = `walletAddress=${encodeURIComponent(depositAddress)}`
const signature = createHmac("sha256", process.env.ONRAMPER_SIGNING_SECRET)
  .update(signContent)
  .digest("hex")
// dev 인스턴스 실측 산출물 (interwoven-1 iUSD triple):
// deposit_address: 0x6f83D3d8966Cd166ADFF61CdC7c36E9FEf06A75a
// sign_content:    walletAddress=0x6f83D3d8966Cd166ADFF61CdC7c36E9FEf06A75a
// signature:       a0317e9e89174efd8eb239340b3382d22ade9ee4f9aa570f19c42d0b15dffcbe
```

### Deposit API → Onramper body (백엔드 참고)

프록시 요청 필드의 Onramper 명칭 매핑(`fiat`→`source`, `crypto`→`destination`, `payment_method`→`paymentMethod`) + `type: "buy"` 고정 + `wallet.address`(재파생한 deposit address) + 서명 산출물. 선택 필드 `partnerContext`/`email`/`originatingHost`/`supportedParams.partnerData.redirectUrl.success`는 생략한다. 인증은 `pk_` 키로 충분하다(secret은 HMAC에만 쓰이고 전송되지 않는다).

```json
{
  "onramp": "banxa",
  "source": "usd",
  "destination": "usdc_ethereum",
  "network": "ethereum",
  "amount": 100,
  "type": "buy",
  "paymentMethod": "creditcard",
  "uuid": "c4efdd02-e956-49a3-9c55-777c2c8288ce",
  "wallet": { "address": "0x6f83D3d8966Cd166ADFF61CdC7c36E9FEf06A75a" },
  "signContent": "walletAddress=0x6f83D3d8966Cd166ADFF61CdC7c36E9FEf06A75a",
  "signature": "a0317e9e89174efd8eb239340b3382d22ade9ee4f9aa570f19c42d0b15dffcbe"
}
```

Onramper 응답은 `message` 래퍼에 `transactionInformation: { transactionId, url, type, params }`와 `status`를 담는다. 프록시는 프론트가 소비하는 `{ transaction_id, url }`만 반환한다.

참고: [Sign API request](https://docs.onramper.com/docs/sign-api-request.md), [URL signing 개요](https://docs.onramper.com/docs/what-is-url-signing.md).

## fiat 단계 추적

`GET /transactions/{id}`는 서버측 전용이다: `Authorization: pk_…`에 더해 `x-onramper-secret`(webhook secret) 헤더가 필수라 pk만으로는 401이다(실측). 프론트는 미사용이며, fiat 단계 추적을 도입한다면 Deposit API 경유여야 한다. 목적지 도착 추적은 deposit 폴링이 담당하므로 현재 필수가 아니다. webhook/SSE는 구현하지 않는다. 응답 스키마(공식 예시): `{ transactionId, status, onramp, country, inAmount, sourceCurrency, outAmount, targetCurrency, walletAddress }`.
