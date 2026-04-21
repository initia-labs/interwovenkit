# Changelog

## [2.8.0](https://github.com/initia-labs/interwovenkit/compare/v2.7.0...v2.8.0) (2026-04-21)


### Features

* **autosign:** export EnableAutoSignOptions type ([31b51c6](https://github.com/initia-labs/interwovenkit/commit/31b51c6bc4c8e1d38bae0afcf13e134d82fc9874))

## [2.7.0](https://github.com/initia-labs/interwovenkit/compare/v2.6.0...v2.7.0) (2026-04-21)


### Features

* **autosign:** support configurable default duration in enable() ([0c19713](https://github.com/initia-labs/interwovenkit/commit/0c1971303d83ab16f70b26e7b6de274942959ba6))

## [2.6.0](https://github.com/initia-labs/interwovenkit/compare/v2.5.1...v2.6.0) (2026-04-07)


### Features

* **connect:** prioritize sign-in wallets by popularity and recency ([17a379a](https://github.com/initia-labs/interwovenkit/commit/17a379a218d9aaaf53d6fdc8d0bb355395cf1f77))


### Bug Fixes

* **bridge,deposit:** improve fee validation for edge cases: guard checks for external chains, restore swap fee warning for non-max inputs, warn on insufficient gas token balance, warn when MAX leaves no fee ([1d3bc99](https://github.com/initia-labs/interwovenkit/commit/1d3bc99575e6eedca9203d447b7d957363c105b8), [c2812a3](https://github.com/initia-labs/interwovenkit/commit/c2812a36c2e9cd96a061f8cb89d358f1043b8400), [4f0c47d](https://github.com/initia-labs/interwovenkit/commit/4f0c47d858496a7ab677f3cfa6d2430c20cb68b0), [88cf52e](https://github.com/initia-labs/interwovenkit/commit/88cf52e1e30b18cf1da332d1960d3c09b6b1f6fd))
* **bridge,deposit:** handle zero-balance states: show insufficient balance for zero-balance tokens, disable withdraw ([00d2a18](https://github.com/initia-labs/interwovenkit/commit/00d2a1874b0e94851b6d976377f1b063ee519e26), [4103b7b](https://github.com/initia-labs/interwovenkit/commit/4103b7b3058295006f8a8fc5996fa3e97c33e181))
* **bridge,deposit:** stabilize route refresh UX ([52a7355](https://github.com/initia-labs/interwovenkit/commit/52a73556adf5e6415961aeeb7dd3a314ba2997d9))
* **bridge:** allow hex addresses as recipient for initia chains ([2d65f41](https://github.com/initia-labs/interwovenkit/commit/2d65f410119f0f64115fa557eaeedcb51335d81a))
* **bridge:** show $- when token has no price ([228d3b3](https://github.com/initia-labs/interwovenkit/commit/228d3b361ec0cab7f57981d6c8994f1df8e02d8b))
* replace .toSorted() with .slice().sort() for browser compatibility ([50b336b](https://github.com/initia-labs/interwovenkit/commit/50b336bb1144f1db0e2b24c3ea19c25a50181ce7))

## [2.5.1](https://github.com/initia-labs/interwovenkit/compare/v2.5.0...v2.5.1) (2026-03-26)


### Bug Fixes

* **autosign:** use initiaAddress for MiniEVM account check ([d140f9e](https://github.com/initia-labs/interwovenkit/commit/d140f9eee59e57d55de5ecaa8eefe0e57c2f453f))

## [2.5.0](https://github.com/initia-labs/interwovenkit/compare/v2.4.6...v2.5.0) (2026-03-25)

### Features

- add aria attributes across the widget ([a792157](https://github.com/initia-labs/interwovenkit/commit/a792157137dc934156a3d72c53fa228d1d1b459b))
- **deposit:** add AUSD as ethereum source for iusd transfers ([970e0a9](https://github.com/initia-labs/interwovenkit/commit/970e0a9361bfcba0287c0f0bdb716f7795600257))
- **testing:** add EVM and Cosmos test wallet factories ([9cabe74](https://github.com/initia-labs/interwovenkit/commit/9cabe74e5f487405813e3b02a17bbfde4216a6a9))

### Bug Fixes

- **bridge:** add aria-label to chain option buttons ([92ca247](https://github.com/initia-labs/interwovenkit/commit/92ca24726730f6e7404881de736fc97596a57c1c))
- **bridge:** handle EVM tx pending timeout with TimeoutError ([6afbbc9](https://github.com/initia-labs/interwovenkit/commit/6afbbc99306c68c8eb6349ad136ff72667445b1f))
- **bridge:** suppress fee warning when alt gas token has balance ([d1909c1](https://github.com/initia-labs/interwovenkit/commit/d1909c109d52dc0e2a02607c87028e42c8ab34f0))
- **components:** allow getImage to return undefined in List ([73ea872](https://github.com/initia-labs/interwovenkit/commit/73ea87222ebe863e18f1da9b1fbc028c98c12d98))
- **copy:** rename user-facing "appchain" to "app" ([63b7054](https://github.com/initia-labs/interwovenkit/commit/63b7054221412310aab58d6132264eaadc528494))
- **deposit:** harden route error state handling ([229ef5b](https://github.com/initia-labs/interwovenkit/commit/229ef5b97151bbebc6e2a247dc266a1bc402d3c1))
- **deposit:** show $- for assets with missing price data ([3988ac1](https://github.com/initia-labs/interwovenkit/commit/3988ac1d06bc744fcb3e1272314358853aa83a8b))
- **deposit:** skip balance validation while loading ([3a8521b](https://github.com/initia-labs/interwovenkit/commit/3a8521bddf8e1473aef97c2df9927a6f8cd1b731))
- **portal:** prevent container reset on modal-drawer transition ([5691b03](https://github.com/initia-labs/interwovenkit/commit/5691b03e458ded3cfcde6e8fcfdeebd2b0d70423))
- simplify TransferTxDetails ([886c29f](https://github.com/initia-labs/interwovenkit/commit/886c29f67e39e048ed27f15571174b2505fb870c))

## [2.4.6](https://github.com/initia-labs/interwovenkit/compare/v2.4.5...v2.4.6) (2026-03-02)

### Features

- **hooks:** accept optional address in useUsernameQuery ([abd0f54](https://github.com/initia-labs/interwovenkit/commit/abd0f54e0038de1a7851812b94d48ffc2ed8e198))

## [2.4.5](https://github.com/initia-labs/interwovenkit/compare/v2.4.4...v2.4.5) (2026-02-26)

### Features

- **prices:** use indexer API for asset price queries ([c8a0176](https://github.com/initia-labs/interwovenkit/commit/c8a017601ed40ac4b81bf008abbf0dbadca7d2ee))

### Bug Fixes

- **deposit:** respect explicit srcOptions over overrides ([8ddaca1](https://github.com/initia-labs/interwovenkit/commit/8ddaca1b7a39bfc48e0f86a487128a5b9b8d04c9))

## [2.4.4](https://github.com/initia-labs/interwovenkit/compare/v2.4.3...v2.4.4) (2026-02-26)

### Features

- **bridge:** display minimum received for swap routes ([696b468](https://github.com/initia-labs/interwovenkit/commit/696b468a936d7a0d79b766805010d68e9e37e771))
- **deposit:** add iUSD extra source list with USDC ([e915bd4](https://github.com/initia-labs/interwovenkit/commit/e915bd43baa302ab3b7ec15c7d4c6313e631d30e))
- **deposit:** add source-aware empty-state messaging ([6490ebb](https://github.com/initia-labs/interwovenkit/commit/6490ebb0dcde1bbc9537f08011590263092712a2))

### Bug Fixes

- **query:** scope retry cache cleanup to interwovenkit queries ([d2404a5](https://github.com/initia-labs/interwovenkit/commit/d2404a583fbce86ab1a452b904ea5ce9f663d838))
- **modal:** add AsyncBoundary and optimize deposit rendering ([2abbfc3](https://github.com/initia-labs/interwovenkit/commit/2abbfc332917d6b64265a823826e293c753f5079))
- **portfolio:** hide VIP positions with no remaining value ([d24e8a8](https://github.com/initia-labs/interwovenkit/commit/d24e8a86412cb1924541296c8f27419a9b07978b))
- **activity:** prevent unit symbol truncation in changes ([5210504](https://github.com/initia-labs/interwovenkit/commit/52105049a876303f38259277d4b18985000dadca))
- **bridge:** prevent invalid balance queries on chain switch ([95a0220](https://github.com/initia-labs/interwovenkit/commit/95a0220001db8450152c34d4c851e36e2b639fcd))
- **bridge:** refresh and requote stale routes ([8f933dd](https://github.com/initia-labs/interwovenkit/commit/8f933dd0f53aba352dd9a0d08e43d1bfcefd11c8))
- **deposit:** auto-prefill single transfer destination ([7a8ec2d](https://github.com/initia-labs/interwovenkit/commit/7a8ec2da7d738f8494333bfb3587131b8674739e))
- **deposit:** keep iUSD source symbol matching ([883a7a6](https://github.com/initia-labs/interwovenkit/commit/883a7a6ea0660b6ef4709e0f54507b8aa6477641))

## [2.4.3](https://github.com/initia-labs/interwovenkit/compare/v2.4.2...v2.4.3) (2026-02-23)

### Features

- **liquidity:** add CLAMM liquidity positions ([063f0ff](https://github.com/initia-labs/interwovenkit/commit/063f0ffc116e3e1b4edf907064e0eed7cd343d64))

## [2.4.2](https://github.com/initia-labs/interwovenkit/compare/v2.4.1...v2.4.2) (2026-02-19)

### Bug Fixes

- **autosign:** restore autosign after reload for direct submit ([c192857](https://github.com/initia-labs/interwovenkit/commit/c192857984ac836a6404958125b76b0522b17a06))

## [2.4.1](https://github.com/initia-labs/interwovenkit/compare/v2.4.0...v2.4.1) (2026-02-19)

### Bug Fixes

- **autosign:** accept apex/www registry host for subdomains ([fb0b590](https://github.com/initia-labs/interwovenkit/commit/fb0b5903a3298deb7c63a3641def462ff67d6e5a))

## [2.4.0](https://github.com/initia-labs/interwovenkit/compare/v2.3.0...v2.4.0) (2026-02-17)

### Features

- **autosign:** replace privy with signature-derived wallet ([1a9a20b](https://github.com/initia-labs/interwovenkit/commit/1a9a20b5e9dad2555ce97cf6bc9fe91c6ea6cc4f))
- **example:** add programmatic test wallet for E2E testing ([636e6e6](https://github.com/initia-labs/interwovenkit/commit/636e6e69a80c26346041c9d3ca0883c43689b1ac))

## [2.3.0](https://github.com/initia-labs/interwovenkit/compare/v2.2.5...v2.3.0) (2026-02-16)

### Features

- **wallet:** send version header in Router API requests ([51a8396](https://github.com/initia-labs/interwovenkit/commit/51a8396472151a26b3f2d1f8fefa8f93e6b8d46e))

## [2.2.5](https://github.com/initia-labs/interwovenkit/compare/v2.2.4...v2.2.5) (2026-02-14)

### Features

- redesigned wallet connection ui ([5472a77](https://github.com/initia-labs/interwovenkit/commit/5472a776f275b3504235c8eb4de08d2584b59570))
- **deposit:** refactor transfer flow for deposit and withdraw ([e5039f0](https://github.com/initia-labs/interwovenkit/commit/e5039f0bd20438fbccc10907c4b438e3cb095e0e))

### Bug Fixes

- **deps:** add @initia/opinit.proto peer dependency ([09b3736](https://github.com/initia-labs/interwovenkit/commit/09b37362dc24d08abfd132af48097ae8820af424))
- **assets:** resolve l2/ denom via trace counterparty lookup ([805f856](https://github.com/initia-labs/interwovenkit/commit/805f8568a66c4c833ea30947b2491a21e46be207))
- **bridge:** fall back to valid asset on unsupported denom ([0f48821](https://github.com/initia-labs/interwovenkit/commit/0f488216925db2dd4f37295b99adf2309e2614a1))
- **bridge:** fall back to alternative route on error ([36cda10](https://github.com/initia-labs/interwovenkit/commit/36cda101afcde6797ba97cd69c863c743b283486))

## [2.2.4](https://github.com/initia-labs/interwovenkit/compare/v2.2.3...v2.2.4) (2026-02-04)

### Features

- **portfolio:** include VIP reward in Initia chain total balance ([425b2dc](https://github.com/initia-labs/interwovenkit/commit/425b2dceac00d800d5cda1739c2d1392d0efe416))
- **bridge:** skip OP withdrawal reminder for migrated bridges ([1ed2df2](https://github.com/initia-labs/interwovenkit/commit/1ed2df2dfc6791a612a1cb599d5fb94b931a1559))

### Bug Fixes

- deposit and withdraw bugs and inconsistencies ([6b692d9](https://github.com/initia-labs/interwovenkit/commit/6b692d90ed04bab69185278c6b667fe6c48793ef))
- **portfolio:** prevent cross-chain denom logo collision ([bd907a5](https://github.com/initia-labs/interwovenkit/commit/bd907a51f3d567e7ff56fe20756fa0d95717b569))
- **bridge:** add route data conditions to Fast/Lossless toggle ([251110e](https://github.com/initia-labs/interwovenkit/commit/251110e1022d6e59fdb67710f6a5a8c7056b1c16))
- **deps:** patch brace-expansion transitive vulnerability ([08c9555](https://github.com/initia-labs/interwovenkit/commit/08c95555ddb5ca62b1f6eae3118e5ac46812ec10))

## [2.2.3](https://github.com/initia-labs/interwovenkit/compare/v2.2.2...v2.2.3) (2026-02-01)

### Bug Fixes

- **assets:** resolve query key collision between useDenoms and WithDenom ([0579b82](https://github.com/initia-labs/interwovenkit/commit/0579b8277f9788c06282e01d08fc507bb2018ff5))

## [2.2.2](https://github.com/initia-labs/interwovenkit/compare/v2.2.1...v2.2.2) (2026-01-28)

### Bug Fixes

- **home:** increase navigation icon size from 16 to 20px ([e69ba44](https://github.com/initia-labs/interwovenkit/commit/e69ba44bfab32b7238a2a49bb891e8ded79f4d6e))
- **minity:** simplify SSE reconnection and add refresh trigger ([56ae7e1](https://github.com/initia-labs/interwovenkit/commit/56ae7e19f42f8cfdebfbaa5bfaacb403129499d1))

## [2.2.1](https://github.com/initia-labs/interwovenkit/compare/v2.2.0...v2.2.1) (2026-01-24)

### Performance Optimization

- externalize video assets to CDN

## [2.2.0](https://github.com/initia-labs/interwovenkit/compare/v2.1.1...v2.2.0) (2026-01-23)

### Features

- add portfolio ([4eea8f9](https://github.com/initia-labs/interwovenkit/commit/4eea8f90b1d38ccb8464a7cb5c996aec4f2f7110))
- deposit and withdraw ([8d92acf](https://github.com/initia-labs/interwovenkit/commit/8d92acf63aa00c75ead83125b7feb09fdc3d17fe))
- **deps:** upgrade [@base-ui](https://github.com/base-ui) to 1.0.0 release version ([2fe745e](https://github.com/initia-labs/interwovenkit/commit/2fe745ea87ec3760fa3f8ec5906560e7f02a3441))

### Bug Fixes

- **bridge:** show dash for unavailable route price ([1319c11](https://github.com/initia-labs/interwovenkit/commit/1319c112fa61a0ec70b97ae35ec1d67c9605043a))

## [2.1.1](https://github.com/initia-labs/interwovenkit/compare/v2.1.0...v2.1.1) (2025-12-17)

### Features

- **autosign:** check account existence before enabling autosign ([02307bf](https://github.com/initia-labs/interwovenkit/commit/02307bf33c6ec594cbd3a96917f086d1893974a3))
- **autosign:** revoke existing grants before enabling new ones ([1f53b13](https://github.com/initia-labs/interwovenkit/commit/1f53b130034ed8891f938e416232b08fe7b2d974))

## [2.1.0](https://github.com/initia-labs/interwovenkit/compare/v2.0.6...v2.1.0) (2025-11-18)

### Features

- **autosign:** implement auto-sign and settings pages ([80b3447](https://github.com/initia-labs/interwovenkit/commit/80b3447425eec213d61b7731a0328427f36f2961))
- **send-nft:** add IBC NFT transfer parameter generation ([91c4231](https://github.com/initia-labs/interwovenkit/commit/91c4231d8f0d2ff3a0b184a07ab7248da3747d44))

## [2.0.6](https://github.com/initia-labs/interwovenkit/compare/v2.0.5...v2.0.6) (2025-10-16)

### Features

- **chains:** add profiles.json fallback for deleted chains ([6e3c113](https://github.com/initia-labs/interwovenkit/commit/6e3c113ab3dc8172e98512850a0897f062d8719a))
- **nft:** validate NFT transferability before sending ([c86e6f2](https://github.com/initia-labs/interwovenkit/commit/c86e6f2ba8ea0b311c3098183e57630cc143cf3b))
- **signer:** fetch public key from REST API first ([7b1ef07](https://github.com/initia-labs/interwovenkit/commit/7b1ef070529411e485222eda6b60b3eb2d5d4463))
- **wallet:** display chain value and NFT count in ChainSelect ([ab4cedc](https://github.com/initia-labs/interwovenkit/commit/ab4cedca1b3041a1c77ee8e273cc3d00037f15b4))
- **wallet:** display disabled message on send forms ([0d3bd71](https://github.com/initia-labs/interwovenkit/commit/0d3bd71c4980ac70088071e3fa83f152ab6e228e))

### Bug Fixes

- **balance:** disable max button when balance is zero ([db2dab2](https://github.com/initia-labs/interwovenkit/commit/db2dab21a1a42e190ca854bbaa61b3f5edbb7c7a))
- **nft:** remove conditional rendering for NFT thumbnails ([5f88909](https://github.com/initia-labs/interwovenkit/commit/5f8890921e65f3fda393d5c88ac778fc95665e38))
- **send:** throw error only when assetlist is missing ([892c7bf](https://github.com/initia-labs/interwovenkit/commit/892c7bf14e2b997a381d476a99b8e132f09142e8))

## [2.0.5](https://github.com/initia-labs/interwovenkit/compare/v2.0.4...v2.0.5) (2025-10-02)

### Features

- **config:** add configurable glyph URL ([98795e8](https://github.com/initia-labs/interwovenkit/commit/98795e8d618f6c74bb42533862bb41d7cefe11c6))
- **tx:** add collapsible fee breakdown ([5446105](https://github.com/initia-labs/interwovenkit/commit/5446105310fef408e4662e5d3e0a28cbc6d73d07))

### Bug Fixes

- **drawer:** add onClick handler to backdrop ([bc8b842](https://github.com/initia-labs/interwovenkit/commit/bc8b842cbfe14984739d1ec9d71ccaa5c57375c0))
- **portfolio:** show chains with balance regardless of value ([59c6cf2](https://github.com/initia-labs/interwovenkit/commit/59c6cf2b695f4bd1f67b4bf90edc13941ed55a5c))
- **send:** add error handling for missing primary asset ([efaa699](https://github.com/initia-labs/interwovenkit/commit/efaa699d472606f15699aef666198f13ab33cf45))

## [2.0.4](https://github.com/initia-labs/interwovenkit/compare/v2.0.3...v2.0.4) (2025-10-01)

### Features

- **tx:** add timeout and interval parameters ([5e52d05](https://github.com/initia-labs/interwovenkit/commit/5e52d0508b20659e6adfd12766fc291592fc1206))

## [2.0.3](https://github.com/initia-labs/interwovenkit/compare/v2.0.2...v2.0.3) (2025-09-30)

### Features

- **interface:** add custom fee handling support ([7a46d80](https://github.com/initia-labs/interwovenkit/commit/7a46d80d3b1d48468072b5f8521427201e27f4b0))
- **form:** add paste handling for formatted numbers ([b452fc9](https://github.com/initia-labs/interwovenkit/commit/b452fc9a981a96fa03261b096a4befdbea04bd8d))
- **form:** improve focus management ([8eb6318](https://github.com/initia-labs/interwovenkit/commit/8eb6318aa5ef38ad0dd18dc54155ade97c78c7c3))
- **tx:** improve fee selector ui design ([04cf0f8](https://github.com/initia-labs/interwovenkit/commit/04cf0f80598f2acc6b28ec060644230298b89f97))
- **bridge:** improve route selection ui ([5d1c601](https://github.com/initia-labs/interwovenkit/commit/5d1c601c86f6f959180a974ee18f9c3adbc4a6fc))
- **bridge:** group history items by date ([02da58d](https://github.com/initia-labs/interwovenkit/commit/02da58dc82883113495dfff4ec9afe1993d06e32))

### Bug Fixes

- **bridge:** handle sequence conflicts in same-chain op hook transactions ([b2ffc73](https://github.com/initia-labs/interwovenkit/commit/b2ffc73af517cae5baa61af75a846a4f5122650b))

## [2.0.2](https://github.com/initia-labs/interwovenkit/compare/v2.0.1...v2.0.2) (2025-09-22)

### Features

- change indexer url ([c456edc](https://github.com/initia-labs/interwovenkit/commit/c456edc4579204937bb24b9277448eb157c67bf4))

## [2.0.1](https://github.com/initia-labs/interwovenkit/compare/v2.0.0...v2.0.1) (2025-09-16)

### Bug Fixes

- **nft:** use collection_addr and token_id for unique key ([492d0d6](https://github.com/initia-labs/interwovenkit/commit/492d0d60a24359005d963ae174123b6252cc1ecd))
