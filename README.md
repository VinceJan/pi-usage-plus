# Pi Usage Plus

[中文文档](./README_zh.md)

Super usage/quota extension for [Pi](https://github.com/earendil-works/pi-mono) and [pi-web](https://github.com/agegr/pi-web) — dual compatible, 10+ providers, Kimi/Moonshot, OpenRouter, OpenCode Go, DeepSeek, GLM, and pi-bridge unified quota.

Forked from [@wayner6/pi-usage](https://github.com/wayner6/pi-usage) with expanded provider coverage and Pi & Pi Web dual-host hardening.

## What it shows

- A compact status line for the active model, such as `Codex · 5h 92% · 7d 85%` or `Kimi · Balance ¥42.50`.
- Remaining balance, rate-limit windows, and reset times when the provider exposes them.
- Details for every configured provider through `/usage`.

The display follows the active model. It does not turn request failures into a zero balance.

## Supported providers

| Provider | Authentication | Available information |
| --- | --- | --- |
| OpenAI Codex | ChatGPT Plus/Pro OAuth | 5-hour and 7-day quota windows |
| xAI / Grok | OAuth | Account verification and spending-limit status |
| Anthropic Claude | Claude OAuth or API key | Subscription status or API rate-limit headers |
| DeepSeek | API key | Account balance |
| GLM / Zhipu BigModel | API key | Coding Plan quota windows; standard pay-as-you-go keys cannot be queried |
| OpenRouter | API key (or OAuth) | Account balance (total_credits - total_usage) |
| OpenCode Go | API key | Rolling 5h / weekly / monthly quota windows |
| Kimi / Moonshot | API key | Account balance (moonshot.cn / moonshot.ai auto-switch) |
| CLIProxyAPI | `pi-bridge` plugin | Upstream quota windows and reset times (requires [`pi-bridge`](https://github.com/abix5/pi-cliproxyapi-bridge) on the proxy) |

- **Pi & Pi Web dual compatible**: Uses standard `ExtensionAPI` (`setStatus`/`setWidget`) which Pi Web's `ExtensionStatusBar`/`ExtensionWidgets` both implement. Includes Pi Web `model_select` watcher (750ms) so idle model switches are reflected.
- **Trust boundary**: All provider requests use `sameOriginFetch(url, expectedOrigin)` – no cross-origin credential leak, no cookie/telemetry forwarding.

Pi Usage Plus uses Pi's existing provider authentication (OAuth tokens or API keys). CLIProxyAPI is queried via `pi-bridge` (Management Key never read).

## Install

### npm (recommended)

In Pi's terminal:

```bash
pi install npm:pi-usage-plus
```

In pi-web: open **Settings** → **Plugins** → **Add Plugin**, enter the following in **Source**, choose `global`, then select **Install**:

```text
npm:pi-usage-plus
```

### GitHub

In Pi's terminal:

```bash
pi install github:VinceJan/pi-usage-plus
```

In pi-web: open **Settings** → **Plugins** → **Add Plugin**, enter:

```text
git:https://github.com/VinceJan/pi-usage-plus
```

After installing or updating, reload the session if it is already open.

## Update

```bash
pi update npm:pi-usage-plus
# or
pi update --extensions
```

In pi-web: **Settings** → **Plugins**, select `pi-usage-plus`, choose **Update**, then use **Reload Session**.

## Use

Send a normal message to refresh the quota for the active model. The status line then updates automatically.

In pi-web, an idle model switch is applied when the next message is sent. To refresh it immediately, use **Reload Session**.

| Command | Result |
| --- | --- |
| `/usage` or `/quota` | Show all available provider balances and quotas |
| `/usage current` | Show the active model's provider only |
| `/usage refresh` | Refresh the active provider now |
| `/usage doctor` | Show authentication, adapter, and bridge diagnostics |
| `/usage settings` | Show current plugin settings |

## Settings

Use `/usage settings` followed by one of these commands:

```text
/usage settings status on|off       # status line; on by default
/usage settings widget on|off       # detailed widget; off by default
/usage settings interval <seconds>  # refresh interval; 120 by default
/usage settings timeout <seconds>   # request timeout; 10 by default
```

Settings are stored locally at `~/.pi/agent/pi-usage/config.json`.

## Privacy

Same as upstream: no browser cookies, telemetry, cloud sync, or third-party credential forwarding. Requests stay on the provider's official origin.

## Credits

- Upstream: [@wayner6/pi-usage](https://github.com/wayner6/pi-usage) – original architecture, pi-bridge, GLM/Dual integration
- Provider APIs: OpenRouter, OpenCode AI, Moonshot, DeepSeek, Anthropic, etc.
- Community: [LINUX DO](https://linux.do/)

## License

[MIT](./LICENSE)
