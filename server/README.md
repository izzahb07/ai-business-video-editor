# AI server (optional)

The video editor works **without** this server. You only need it for:

| Feature | Without server | With server |
|---|---|---|
| Auto captions | On-device speech model (free, private, slower; weaker Bahasa Melayu) | Cloud speech-to-text (fast, accurate, good Bahasa Melayu) |
| Hooks, structure, titles, CTA | Offline templates (clearly marked "not AI") | Written by Claude from your captions + description |
| Smart editing (silence, scenes, repeats, best moments) | ✅ Works on-device | Same (never uses the server) |

## Why a server at all?
API keys must **never** be inside an app: anyone could open the website, copy the key and spend your money.
This small Cloudflare Worker keeps your keys as encrypted secrets and only answers requests that:
1. come from your app's address (`ALLOWED_ORIGINS`), and
2. carry your passcode (`APP_PASSCODE`, compared in constant time).

## What gets sent (only after you tap "Allow" in the app)
- **Captions:** the clip's **audio only** (mono 16 kHz WAV, max 25 MB per part — long clips are split). Video is never uploaded.
- **Hooks:** your typed description + the caption **text**. No audio, no video.
- The server forwards these to the provider and returns the result. It stores nothing.
- You can withdraw permission any time: app → ⓘ → AI server → "Withdraw permission".

## Costs (check the providers' current prices)
| Service | Used for | Typical cost |
|---|---|---|
| Cloudflare Workers | Runs this server | Free plan: 100,000 requests/day |
| OpenAI `whisper-1` | Captions (default) | ≈ US$0.006 per minute of audio |
| Groq `whisper-large-v3-turbo` (alternative) | Captions | Cheaper per hour; set `TRANSCRIBE_BASE_URL`/`TRANSCRIBE_MODEL` in `wrangler.toml` |
| Anthropic Claude (`claude-opus-5-5`) | Hooks & structure | ≈ US$0.05–0.15 per "Generate" (US$4 / 1M input, US$20 / 1M output tokens) |

Set spending limits in each provider's dashboard.

## Set it up from your iPhone (no computer needed)

1. **Cloudflare** (free): create an account at dash.cloudflare.com.
   - *My Profile → API Tokens → Create Token → "Edit Cloudflare Workers" template → Create.* Copy the token.
   - Your **Account ID** is on the Workers & Pages overview page (right side).
2. **Keys** (only for the features you want):
   - Captions: an OpenAI API key (platform.openai.com → API keys), or a Groq key.
   - Hooks: an Anthropic API key (console.anthropic.com → API keys).
3. **GitHub secrets**: open your repository on github.com → *Settings → Secrets and variables → Actions → New repository secret*. Add:
   | Name | Value |
   |---|---|
   | `CLOUDFLARE_API_TOKEN` | token from step 1 |
   | `CLOUDFLARE_ACCOUNT_ID` | account ID from step 1 |
   | `APP_PASSCODE` | any long password you make up (you'll type it in the app) |
   | `TRANSCRIBE_API_KEY` | OpenAI (or Groq) key — optional |
   | `ANTHROPIC_API_KEY` | Anthropic key — optional |
4. **Deploy**: *Actions → "Deploy AI server (optional)" → Run workflow*. Wait for the green tick.
   The log's "Deploy worker" step shows your address, like `https://ai-video-studio-server.<you>.workers.dev`.
5. **Connect the app**: open the editor → **ⓘ** → *AI server* → paste the address and passcode → **Save & test connection**.
   You should see "Connected ✓ · Transcription: ready · AI hooks: ready".

If your app lives at a different address than `https://izzahb07.github.io`, change `ALLOWED_ORIGINS` in `server/wrangler.toml`.
If you use Groq, uncomment the two Groq lines in `wrangler.toml` before deploying.

## For developers
```bash
cd server
npm install
npm test            # worker tests (auth, CORS, transcription mapping, Claude call & refusal handling)
npx wrangler dev    # local server
npx wrangler deploy
```
Endpoints: `GET /health`, `POST /transcribe` (multipart `file`, optional `language` = `en`/`ms`), `POST /ai/hooks` (JSON: `transcript`, `description`, `objective`, `language`, `durationSec`).
All require the `X-App-Passcode` header.
