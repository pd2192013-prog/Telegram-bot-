// =========================================================
// TELEGRAM MATH BOT — Cloudflare Worker (single file)
// APINEX API VERSION
// Sirf likhit Math ke sawalon ka jawab deta hai (APInex API se)
// Rate limit: 15 sawal / 1 ghanta / user
// =========================================================

// ⚠️ Ye teeno values ab seedha yahan likhne ki zaroorat nahi hai.
// Cloudflare Worker ke Settings → Variables and Secrets me
// BOT_TOKEN, APINEX_API_KEY aur APINEX_MODEL naam se secret add karein,
// code automatically wahi values use kar lega.
// (Agar aap chahte hain to yahan neeche bhi bhar sakte hain — ye sirf
// fallback hai, jab Cloudflare secret na mila ho tab hi use hoga.)
const BOT_TOKEN_FALLBACK = "YAHAN_APNA_TELEGRAM_BOT_TOKEN_DALEIN";
const APINEX_API_KEY_FALLBACK = "YAHAN_APNI_APINEX_API_KEY_DALEIN"; // jaise sk-apx...
const APINEX_MODEL_FALLBACK = "YAHAN_APNA_MODEL_NAAM_DALEIN"; // jaise gpt/5.6-sol

// ---- Helper: env se ya fallback se config value lo ----
function getConfig(env) {
  return {
    BOT_TOKEN: (env && env.BOT_TOKEN) || BOT_TOKEN_FALLBACK,
    APINEX_API_KEY: (env && env.APINEX_API_KEY) || APINEX_API_KEY_FALLBACK,
    APINEX_MODEL: (env && env.APINEX_MODEL) || APINEX_MODEL_FALLBACK,
  };
}

const RATE_LIMIT_COUNT = 15;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 ghanta

// ---- Fixed Hindi replies ----
const NON_MATH_REPLY = "मैं केवल गणित के सवाल हल कर सकता हूँ, कृपया गणित से जुड़ा सवाल लिखकर पूछें।";
const PHOTO_REPLY = "कृपया सवाल लिखकर भेजें, मैं केवल लिखित गणित के सवाल हल करता हूँ।";
const START_REPLY =
  "नमस्ते! मुझसे केवल गणित के सवाल पूछिए, मैं चरण-दर-चरण हल बताऊँगा।\nआप एक घंटे में केवल 15 सवाल पूछ सकते हैं।";
const GENERIC_ERROR_REPLY = "क्षमा कीजिए, अभी उत्तर तैयार करने में समस्या आई है। कृपया थोड़ी देर बाद पुनः प्रयास करें।";

// ---- SYSTEM PROMPT for APInex (poori Hindi me) ----
const SYSTEM_PROMPT = `तुम एक ऐसा सहायक हो जो केवल गणित (Mathematics) के सवालों के उत्तर देता है, बिल्कुल एक school ki NCERT/Reference textbook ke solution jaisa.

नियम (इन सभी का सख्ती से पालन करो):

1. अगर उपयोगकर्ता का सवाल गणित (अंकगणित, बीजगणित, ज्यामिति, त्रिकोणमिति, कैलकुलस, सांख्यिकी आदि) से संबंधित नहीं है, तो सिर्फ और सिर्फ यही उत्तर दो, कोई अतिरिक्त शब्द मत लिखो:
"${NON_MATH_REPLY}"

2. अगर सवाल गणित का है, तो जवाब बिल्कुल Telegram पर सीधा पढ़े जाने लायक plain text में लिखो — jaise ek copy me haath se likha hua solution hota hai। नीचे दिए गए FORMAT RULES को 100% follow karo, ek bhi exception nahi:

FORMAT RULES (bahut zaroori, kabhi mat todna):
   - LaTeX code KABHI mat likho। Ye sab bilkul use mat karo: \\frac, \\neq, \\overline, \\boxed, \\quad, \\sqrt, \\pi, $, $$, ^{}, _{}, \\left, \\right, ya koi bhi backslash-command.
   - Markdown table (| | | ya |---|---|) KABHI mat banao।
   - Markdown heading (#, ##) ya bold markers (**, __) KABHI mat use karo।
   - Fraction hamesha simple slash se likho, jaise p/q, 3/4, 195°/3 — "\\frac{p}{q}" jaisa kabhi mat likho।
   - Ye normal keyboard/unicode symbols hi use karo: + - × ÷ = ° ∠ △ √ π ≠ ⇒ ∵ ∴ ± ≤ ≥
   - Har equation/step ek naya line par likho, jaise textbook me hota hai:
     ∠A + ∠B + ∠C = 180°
     55° + 40° + ∠C = 180°
     ∠C = 180° − 95° = 85°
   - Agar ek se zyada equation number karni ho to "...(1)", "...(2)" jaisa likh sakte ho, bilkul textbook jaisa।
   - Solution ka structure simple plain labels se banao (bina # ya ** ke), jaise:
     हल:
     (step by step calculation yahan)
     अंतिम उत्तर: (final answer yahan)
   - "दिया गया है:" (agar zaroori ho) aur "अंतिम उत्तर:" jaisa plain label likho, koi markdown formatting nahi।

3. भाषा हमेशा शुद्ध और स्पष्ट हिंदी में रखो। टूटी-फूटी, OCR जैसी या मशीनी भाषा बिल्कुल इस्तेमाल मत करो। गणितीय संख्याएँ और चिन्ह (जैसे x, y, +, =) अंग्रेज़ी में ही रहेंगे, बाकी पूरा विवरण शुद्ध हिंदी में लिखो।

4. सिर्फ गणित का हल दो, कोई अनावश्यक बातचीत मत करो। कोई intro/outro sentence mat likho, seedha "हल:" se shuru karo।`;

// ---- Helper: sleep ----
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- Helper: Telegram ko message bhejo ----
async function sendMessage(env, chatId, text) {
  const { BOT_TOKEN } = getConfig(env);
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

// ---- Helper: "typing..." dikhane ke liye ----
async function sendTyping(env, chatId) {
  const { BOT_TOKEN } = getConfig(env);
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendChatAction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action: "typing" }),
    });
  } catch (e) {
    // ignore
  }
}

// ---- APInex se jawab lete waqt "typing..." dikhate rehna ----
async function askApinexWithTyping(env, chatId, question) {
  let finished = false;
  const apinexPromise = askApinex(env, question).then((res) => {
    finished = true;
    return res;
  });

  (async () => {
    while (!finished) {
      await sendTyping(env, chatId);
      await sleep(4000);
    }
  })();

  return apinexPromise;
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

  if (!data || now > data.resetTime) {
    const resetTime = now + RATE_LIMIT_WINDOW_MS;
    const newData = { count: 1, resetTime };
    try {
      await env.MATH_BOT_KV.put(key, JSON.stringify(newData), {
        expirationTtl: Math.ceil(RATE_LIMIT_WINDOW_MS / 1000) + 60,
      });
    } catch (e) {
      // KV na ho to bhi rate limit ke bina bot chalta rahe
    }
    return { allowed: true };
  }

  if (data.count >= RATE_LIMIT_COUNT) {
    return { allowed: false, resetTime: data.resetTime };
  }

  data.count += 1;
  const ttl = Math.max(60, Math.ceil((data.resetTime - now) / 1000));
  try {
    await env.MATH_BOT_KV.put(key, JSON.stringify(data), {
      expirationTtl: ttl,
    });
  } catch (e) {
    // ignore
  }
  return { allowed: true };
}

// ---- APInex API call ----
async function askApinex(env, question) {
  const { APINEX_API_KEY, APINEX_MODEL } = getConfig(env);
  const url = "https://api.apinex.bond/v1/chat/completions";

  const body = {
    model: APINEX_MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: question },
    ],
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${APINEX_API_KEY}`,
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    if (!res.ok) {
      // TEMPORARY DEBUG: asli error seedha Telegram me dikhega
      return `DEBUG ERROR (status ${res.status}): ${JSON.stringify(data)}`;
    }

    const text = data?.choices?.[0]?.message?.content;
    return text ? text.trim() : GENERIC_ERROR_REPLY;
  } catch (err) {
    return `DEBUG FETCH ERROR: ${err.message}`;
  }
}

// ---- Main Worker ----
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Debug route: seedha test karta hai token sahi hai ya nahi
    if (url.pathname === "/debug") {
      const { BOT_TOKEN, APINEX_API_KEY, APINEX_MODEL } = getConfig(env);
      let telegramCheck = "not tested";
      try {
        const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`);
        telegramCheck = await r.json();
      } catch (e) {
        telegramCheck = `fetch failed: ${e.message}`;
      }
      let kvCheck = "not tested";
      try {
        await env.MATH_BOT_KV.put("debug_test", "ok", { expirationTtl: 60 });
        kvCheck = await env.MATH_BOT_KV.get("debug_test");
      } catch (e) {
        kvCheck = `KV failed: ${e.message}`;
      }
      let apinexCheck = "not tested";
      try {
        const r2 = await fetch("https://api.apinex.bond/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${APINEX_API_KEY}`,
          },
          body: JSON.stringify({
            model: APINEX_MODEL,
            messages: [{ role: "user", content: "2+2 kitna hota hai, ek shabd me jawab do" }],
          }),
        });
        apinexCheck = await r2.json();
      } catch (e) {
        apinexCheck = `fetch failed: ${e.message}`;
      }
      return new Response(
        JSON.stringify({ telegramCheck, kvCheck, apinexCheck }, null, 2),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // Ek baar visit karke webhook set karne ke liye (deploy ke baad browser me kholein)
    if (url.pathname === "/setWebhook") {
      const { BOT_TOKEN } = getConfig(env);
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
      if (!message || !message.chat || !message.from) {
        return new Response("ok");
      }

      const chatId = message.chat.id;
      const userId = message.from.id;

      // Agar photo/image bheji hai to seedha fixed reply do, APInex ko mat bhejo
      if (message.photo || message.document) {
        ctx.waitUntil(sendMessage(env, chatId, PHOTO_REPLY));
        return new Response("ok");
      }

      if (!message.text) {
        return new Response("ok");
      }

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
      await sendMessage(env, chatId, START_REPLY);
      return;
    }

    const rateCheck = await checkRateLimit(env, userId);

    if (!rateCheck.allowed) {
      const resetTimeStr = formatResetTime(rateCheck.resetTime);
      await sendMessage(
        env,
        chatId,
        `आप मुझसे एक घंटे में केवल 15 सवाल पूछ सकते हैं, अभी आपकी सीमा समाप्त हो चुकी है। कृपया ${resetTimeStr} के बाद पुनः प्रयास करें।`
      );
      return;
    }

    const answer = await askApinexWithTyping(env, chatId, text);
    await sendMessage(env, chatId, answer);
  } catch (err) {
    try {
      await sendMessage(env, chatId, `DEBUG HANDLE ERROR: ${err.message}`);
    } catch (e) {
      // agar ye bhi fail ho jaye to kuch nahi ho sakta
    }
  }
}
