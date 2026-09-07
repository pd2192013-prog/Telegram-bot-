// =========================================================
// TELEGRAM MATH BOT — Cloudflare Worker (single file)
// Sirf Math ke sawalon ka jawab deta hai (Gemini API se)
// Rate limit: 15 sawal / 1 ghanta / user
// =========================================================

// ---- CONFIG (aapke diye gaye values yaha set hain) ----
const BOT_TOKEN = "8934885021:AAHOig55eA6B4V38EurEdCeM9PSeAhh9Qcs";
const GEMINI_API_KEY = "AQ.Ab8RN6KVIk2FTvUUdTvbSfNpLCP2aZg7LMt2rK2vsj0SZvExUg";
const GEMINI_MODEL = "gemini-3.5-flash-lite";

const RATE_LIMIT_COUNT = 15;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 ghanta

const NON_MATH_REPLY =
  "Main Keval math ke sawal karne ke liye banaya gya hu mujhse math ke sawal likh ker puche";

// ---- SYSTEM PROMPT for Gemini ----
const SYSTEM_PROMPT = `Tum ek AI ho jo SIRF MATH ke sawalon ke jawab dete ho.

Rules (in sabko strictly follow karo):
1. Agar user ka sawal math (arithmetic, algebra, geometry, trigonometry, calculus, statistics, etc.) se related NAHI hai, to sirf aur SIRF yeh exact reply do, koi extra shabd mat likho:
"${NON_MATH_REPLY}"

2. Agar sawal math ka hai, to solution ek kitab jaisa, saaf aur step-by-step tarike se likho:
   - Diya gaya (Given) kya hai batao
   - Formula/concept batao jo use ho raha hai
   - Step by step calculation dikhao
   - Aakhir me Final Answer clearly bold/highlight karke do
3. OCR jaisi tooti-phooti ya messy language bilkul use mat karo. Proper, saaf-suthri Hindi/English mix bhasha use karo jaise kisi achhi textbook me solution likha hota hai.
4. Sirf math ke solution do, unnecessary baatcheet mat karo.`;

// ---- Helper: Telegram ko message bhejo ----
async function sendMessage(chatId, text) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
    }),
  });
}

// ---- Helper: Time ko readable format me convert karo (IST) ----
function formatResetTime(timestampMs) {
  const date = new Date(timestampMs);
  return date.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    day: "2-digit",
    month: "2-digit",
  });
}

// ---- Rate limiting logic using Cloudflare KV ----
async function checkRateLimit(env, userId) {
  const key = `rate_${userId}`;
  const now = Date.now();

  let data = null;
  try {
    const raw = await env.MATH_BOT_KV.get(key);
    data = raw ? JSON.parse(raw) : null;
  } catch (e) {
    data = null;
  }

  // Naya window shuru karo agar data nahi hai ya window khatm ho chuka hai
  if (!data || now > data.resetTime) {
    const resetTime = now + RATE_LIMIT_WINDOW_MS;
    const newData = { count: 1, resetTime };
    await env.MATH_BOT_KV.put(key, JSON.stringify(newData), {
      expirationTtl: Math.ceil(RATE_LIMIT_WINDOW_MS / 1000) + 60,
    });
    return { allowed: true };
  }

  if (data.count >= RATE_LIMIT_COUNT) {
    return { allowed: false, resetTime: data.resetTime };
  }

  data.count += 1;
  const ttl = Math.max(60, Math.ceil((data.resetTime - now) / 1000));
  await env.MATH_BOT_KV.put(key, JSON.stringify(data), {
    expirationTtl: ttl,
  });
  return { allowed: true };
}

// ---- Gemini API call ----
async function askGemini(question) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const body = {
    system_instruction: {
      parts: [{ text: SYSTEM_PROMPT }],
    },
    contents: [
      {
        role: "user",
        parts: [{ text: question }],
      },
    ],
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    if (!res.ok) {
      console.log("Gemini API error:", JSON.stringify(data));
      return "Maaf kijiye, abhi jawab generate karne me dikkat aayi. Thodi der baad dobara try karein.";
    }

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    return text ? text.trim() : "Maaf kijiye, jawab nahi mil paya. Dobara try karein.";
  } catch (err) {
    console.log("Gemini fetch error:", err.message);
    return "Maaf kijiye, abhi jawab generate karne me dikkat aayi. Thodi der baad dobara try karein.";
  }
}

// ---- Main Worker ----
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Ek baar visit karke webhook set karne ke liye (deploy ke baad browser me kholein)
    if (url.pathname === "/setWebhook") {
      const webhookUrl = `${url.origin}/webhook`;
      const res = await fetch(
        `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${encodeURIComponent(
          webhookUrl
        )}`
      );
      const result = await res.text();
      return new Response(result, {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Telegram webhook endpoint
    if (url.pathname === "/webhook" && request.method === "POST") {
      let update;
      try {
        update = await request.json();
      } catch (e) {
        return new Response("ok");
      }

      const message = update.message;
      if (!message || !message.text || !message.chat || !message.from) {
        return new Response("ok");
      }

      const chatId = message.chat.id;
      const userId = message.from.id;
      const text = message.text.trim();

      ctx.waitUntil(handleMessage(env, chatId, userId, text));

      return new Response("ok");
    }

    return new Response("Math Bot Worker chal raha hai ✅");
  },
};

// ---- Message handling logic (async, background me chalega) ----
async function handleMessage(env, chatId, userId, text) {
  try {
    if (text === "/start") {
      await sendMessage(
        chatId,
        "Namaste! Mujhse sirf MATH ke sawal puchiye, main step-by-step solution dunga.\nAap 1 ghante me sirf 15 sawal puch sakte hain."
      );
      return;
    }

    const rateCheck = await checkRateLimit(env, userId);

    if (!rateCheck.allowed) {
      const resetTimeStr = formatResetTime(rateCheck.resetTime);
      await sendMessage(
        chatId,
        `App mujhse 1 ghante me 15 sawal puch sakte hain ab apki limit khatm ho chuki hai. ${resetTimeStr} baje samay baad fir koshish kre`
      );
      return;
    }

    const answer = await askGemini(text);
    await sendMessage(chatId, answer);
  } catch (err) {
    console.log("handleMessage error:", err.message);
    await sendMessage(chatId, "Kuch error aa gaya, dobara try karein.");
  }
}
