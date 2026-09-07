# Telegram Math Bot — Cloudflare Worker

Sirf math ke sawalon ka jawab deta hai (Gemini API se), 15 sawal/ghanta limit ke saath.

## ⚠️ Error se bachne ke liye — yeh 2 steps MISS mat karna

Deploy fail ya bot kaam na karne ka 90% reason yehi 2 cheezein hoti hain:

### Step 1 — KV Namespace banao (rate limit ke liye zaroori hai)

Terminal me (is folder ke andar):

```
npx wrangler login
npx wrangler kv namespace create MATH_BOT_KV
```

Isse jo output aayega usme ek `id = "xxxxxxxx"` milega. Usko `wrangler.toml` file me
`PASTE_YOUR_KV_NAMESPACE_ID_HERE` ki jagah paste karo, phir GitHub par push karo.

Agar yeh step skip kiya to deploy error dega: `KV namespace 'MATH_BOT_KV' is not valid`.

### Step 2 — GitHub → Cloudflare connect karo

1. Is poore folder ko GitHub repo me push karo.
2. Cloudflare dashboard → **Workers & Pages** → **Create** → **Connect to Git** → apna repo select karo.
3. Build settings me kuch change karne ki zaroorat nahi — `wrangler.toml` khud sab handle kar lega.
4. Deploy button dabao.

### Step 3 — Webhook set karo (ek baar, deploy hone ke baad)

Deploy hone ke baad jo URL milega (e.g. `https://telegram-math-bot.xxx.workers.dev`),
usko browser me kholo aur end me `/setWebhook` lagao:

```
https://telegram-math-bot.xxx.workers.dev/setWebhook
```

Response me `"ok":true` aana chahiye — iska matlab bot Telegram se connect ho gaya.

## Files

- `src/index.js` — poora bot logic (Telegram webhook + Gemini API + rate limit)
- `wrangler.toml` — Cloudflare config (KV namespace id yaha dalna hai)
- `package.json` — dependencies
- `.gitignore` — node_modules waghera GitHub par jaane se rokta hai

## Test kaise karein

Deploy + webhook set karne ke baad, apne Telegram bot ko koi bhi math sawal
(jaise "2x + 5 = 15 solve karo") bhejo — step-by-step solution aayega.
Non-math sawal bhejne par fixed reply aayega. 15 sawal ke baad 1 ghante ke liye limit lag jayegi.
