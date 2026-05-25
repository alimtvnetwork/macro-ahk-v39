# gitsync API — Request & Response Samples

> Captured verbatim from user-provided sample on 2026-05-24. Preserved
> in its own spec file per user instruction.

## Request

```js
fetch("https://api.lovable.dev/workspaces/workspace_01kq2hd073fyj9fykzvwgtgd86/projects/86637818-4809-469f-9238-3f4256471559/gitsync", {
  "headers": {
    "accept": "*/*",
    "accept-language": "en-US,en-GB;q=0.9,en;q=0.8,bn-BD;q=0.7,bn;q=0.6",
    "authorization": "Bearer <REDACTED>",
    "content-type": "application/json",
    "priority": "u=1, i",
    "sec-ch-ua": "\"Chromium\";v=\"148\", \"Google Chrome\";v=\"148\", \"Not/A)Brand\";v=\"99\"",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "\"Windows\"",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-site",
    "x-browser-session-id": "bsess_01ksczht7zfk58r41bkw17svh8",
    "x-client-git-sha": "80f890dd39fd7aa496d1dc1ed9a9a3448efe9652",
    "x-lovable-read-after": "1779625946940"
  },
  "referrer": "https://lovable.dev/",
  "body": null,
  "method": "GET",
  "mode": "cors",
  "credentials": "include"
});
```

### Minimal headers we will send

The Macro Controller only needs:
- `accept: */*`
- `authorization: Bearer <token-from-getBearerToken()>`
- `content-type: application/json`

Everything else (`sec-ch-ua-*`, `x-browser-session-id`, `x-client-git-sha`,
`x-lovable-read-after`, `priority`) is browser-injected metadata that the
upstream API ignores.

## Response (synced, github provider)

```json
{
  "synced": true,
  "config": {
    "provider_type": "github",
    "connection_id": "13c494e6-c141-4f99-9938-9f733f2d2857",
    "repo_name": "macro-ahk-v37",
    "repo_url": "https://github.com/alimtvnetwork/macro-ahk-v37",
    "owner_name": "alimtvnetwork"
  }
}
```

## Response variants we handle

| Variant | Recognition | Cache as |
|---|---|---|
| Found | `synced === true && config?.repo_url` non-empty | `Status='found'` (∞ TTL) |
| Not linked | `synced === false` OR `config == null` OR `repo_url` missing | `Status='not_linked'` (24h TTL) |
| HTTP error | non-2xx status | `Status='error'` (5m TTL) |
