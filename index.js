// =========================================================
// TELEGRAM MATH BOT — Cloudflare Worker (single file)
// Sirf likhit Math ke sawalon ka jawab deta hai (Gemini API se)
// Rate limit: 15 sawal / 1 ghanta / user
// BOT_TOKEN, GEMINI_API_KEY, GEMINI_MODEL Cloudflare "Secrets" se aate hain
// (Settings -> Runtime variables and secrets)
// =========================================================

const RATE_LIMIT_COUNT = 15;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 ghanta

// ---- Fixed Hindi replies ----
const NON_MATH_REPLY = "मैं केवल गणित के सवाल हल कर सकता हूँ, कृपया गणित से जुड़ा सवाल लिखकर पूछें।";
const PHOTO_REPLY = "कृपया सवाल लिखकर भेजें, मैं केवल लिखित गणित के सवाल हल करता हूँ।";
const START_REPLY =
  "नमस्ते! मुझसे केवल गणित के सवाल पूछिए, मैं चरण-दर-चरण हल बताऊँगा।\nआप एक घंटे में केवल 15 सवाल पूछ सकते हैं।";
const GENERIC_ERROR_REPLY = "क्षमा कीजिए, अभी उत्तर तैयार करने में समस्या आई है। कृपया थोड़ी देर बाद पुनः प्रयास करें।";

// ---- SYSTEM PROMPT for Gemini (poori Hindi me) ----
const SYSTEM_PROMPT = `तुम एक ऐसा सहायक हो जो केवल गणित (Mathematics) के सवालों के उत्तर देता है।

नियम (इन सभी का सख्ती से पालन करो):

1. अगर उपयोगकर्ता का सवाल गणित (अंकगणित, बीजगणित, ज्यामिति, त्रिकोणमिति, कैलकुलस, सांख्यिकी आदि) से संबंधित नहीं है, तो सिर्फ और सिर्फ यही उत्तर दो, कोई अतिरिक्त शब्द मत लिखो:
"${NON_MATH_REPLY}"

2. अगर सवाल गणित का है, तो हल एक अच्छी पाठ्यपुस्तक (textbook) जैसा, साफ और चरण-दर-चरण (step-by-step) तरीके से लिखो:
   - सबसे पहले "दिया गया है (Given):" लिखकर जानकारी बताओ
   - जो सूत्र/संकल्पना (formula/concept) इस्तेमाल हो रही है उसे बताओ
   - चरण-दर-चरण गणना (calculation) दिखाओ
   - अंत में "अंतिम उत्तर:" साफ-साफ हाईलाइट करके दो

3. भाषा हमेशा शुद्ध और स्पष्ट हिंदी में रखो। टूटी-फूटी, OCR जैसी या मशीनी भाषा बिल्कुल इस्तेमाल मत करो। गणितीय संख्याएँ और चिन्ह (जैसे x, y, +, =) अंग्रेज़ी में ही रहेंगे, बाकी पूरा विवरण शुद्ध हिंदी में लिखो।

4. सिर्फ गणित का हल दो, कोई अनावश्यक बातचीत मत करो।`;

// ---- Helper: sleep ----
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- Helper: Telegram ko message bhejo ----
async function sendMessage(env, chatId, text) {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`;
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
  try {
    await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendChatAction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action: "typing" }),
    });
  } catch (e) {
    // ignore
  }
}

// ---- Gemini se jawab lete waqt "typing..." dikhate rehna ----
async function askGeminiWithTyping(env, chatId, question) {
  let finished = false;
  const geminiPromise = askGemini(env, question).then((res) => {
    finished = true;
    return res;
  });

  (async () => {
    while (!finished) {
      await sendTyping(env, chatId);
      await sleep(4000);
    }
  })();

  return geminiPromise;
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
async function askGemini(env, question) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:generateContent`;

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
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": env.GEMINI_API_KEY,
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    if (!res.ok) {
      // TEMPORARY DEBUG: asli error seedha Telegram me dikhega
      return `DEBUG ERROR (status ${res.status}): ${JSON.stringify(data)}`;
    }

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    return text ? text.trim() : GENERIC_ERROR_REPLY;
  } catch (err) {
    return `DEBUG FETCH ERROR: ${err.message}`;
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
        `https://api.telegram.org/bot${env.BOT_TOKEN}/setWebhook?url=${encodeURIComponent(
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

      // Agar photo/image bheji hai to seedha fixed reply do, Gemini ko mat bhejo
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

    const answer = await askGeminiWithTyping(env, chatId, text);
    await sendMessage(env, chatId, answer);
  } catch (err) {
    await sendMessage(env, chatId, `DEBUG HANDLE ERROR: ${err.message}`);
  }
}
