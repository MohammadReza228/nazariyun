const SESSION_DAYS = 7;
const MAX_MESSAGE_LENGTH = 4000;

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extra
    }
  });

const now = () => Math.floor(Date.now() / 1000);

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type, authorization",
    "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS"
  };
}

function withCors(response) {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(corsHeaders())) headers.set(k, v);
  return new Response(response.body, { status: response.status, headers });
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function randomToken(bytes = 32) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map(b => b.toString(16).padStart(2, "0")).join("");
}

function cleanUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function validUsername(username) {
  return /^[a-z0-9_]{3,24}$/.test(username);
}

async function derivePassword(password, saltBytes, iterations = 120000) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: saltBytes, iterations, hash: "SHA-256" },
    key,
    256
  );
  return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function hashPassword(password) {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const hash = await derivePassword(password, salt);
  return `pbkdf2$120000$${[...salt].map(b => b.toString(16).padStart(2, "0")).join("")}$${hash}`;
}

async function verifyPassword(password, stored) {
  const [algo, iter, saltHex, expected] = String(stored).split("$");
  if (algo !== "pbkdf2" || !iter || !saltHex || !expected) return false;
  const salt = new Uint8Array(saltHex.match(/.{2}/g).map(x => parseInt(x, 16)));
  const actual = await derivePassword(password, salt, Number(iter));
  return actual === expected;
}

function bearer(request) {
  const value = request.headers.get("authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

async function currentUser(request, env) {
  const token = bearer(request);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(`
    SELECT u.id, u.username, u.display_name, u.avatar, u.bio, u.created_at, u.updated_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `).bind(tokenHash, now()).first();
  return row || null;
}

async function createSession(env, userId) {
  const token = randomToken(32);
  const tokenHash = await sha256(token);
  const created = now();
  const expires = created + SESSION_DAYS * 86400;
  await env.DB.prepare(
    "INSERT INTO sessions (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)"
  ).bind(userId, tokenHash, expires, created).run();
  return { token, expires_at: expires };
}

async function body(request) {
  try { return await request.json(); }
  catch { return null; }
}

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });

  if (path === "/api/health" && method === "GET") {
    return json({ ok: true, service: "Nazariyun", time: now() });
  }

  if (path === "/api/register" && method === "POST") {
    const data = await body(request);
    const username = cleanUsername(data?.username);
    const password = String(data?.password || "");
    const displayName = String(data?.display_name || username).trim().slice(0, 50);

    if (!validUsername(username))
      return json({ error: "نام کاربری باید ۳ تا ۲۴ کاراکتر و فقط شامل حروف انگلیسی، عدد و _ باشد." }, 400);
    if (password.length < 8)
      return json({ error: "رمز عبور باید حداقل ۸ کاراکتر باشد." }, 400);

    const exists = await env.DB.prepare("SELECT id FROM users WHERE username = ?").bind(username).first();
    if (exists) return json({ error: "این نام کاربری قبلاً ثبت شده است." }, 409);

    const t = now();
    const passwordHash = await hashPassword(password);
    const result = await env.DB.prepare(
      "INSERT INTO users (username, password_hash, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
    ).bind(username, passwordHash, displayName, t, t).run();

    const userId = result.meta.last_row_id;
    const session = await createSession(env, userId);
    return json({
      ok: true,
      token: session.token,
      expires_at: session.expires_at,
      user: { id: userId, username, display_name: displayName, avatar: null, bio: null }
    }, 201);
  }

  if (path === "/api/login" && method === "POST") {
    const data = await body(request);
    const username = cleanUsername(data?.username);
    const password = String(data?.password || "");
    const user = await env.DB.prepare(
      "SELECT id, username, password_hash, display_name, avatar, bio FROM users WHERE username = ?"
    ).bind(username).first();

    if (!user || !(await verifyPassword(password, user.password_hash)))
      return json({ error: "نام کاربری یا رمز عبور اشتباه است." }, 401);

    const session = await createSession(env, user.id);
    return json({
      ok: true,
      token: session.token,
      expires_at: session.expires_at,
      user: {
        id: user.id, username: user.username, display_name: user.display_name,
        avatar: user.avatar, bio: user.bio
      }
    });
  }

  const user = await currentUser(request, env);

  if (path === "/api/logout" && method === "POST") {
    const token = bearer(request);
    if (token) {
      await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
    }
    return json({ ok: true });
  }

  if (path === "/api/me" && method === "GET") {
    if (!user) return json({ authenticated: false });
    return json({ authenticated: true, user });
  }

  if (path === "/api/users" && method === "GET") {
    if (!user) return json({ error: "نیاز به ورود دارید." }, 401);
    const q = String(url.searchParams.get("q") || "").trim().toLowerCase();
    if (q.length < 2) return json({ users: [] });
    const rows = await env.DB.prepare(`
      SELECT id, username, display_name, avatar, bio
      FROM users WHERE username LIKE ? OR lower(COALESCE(display_name,'')) LIKE ?
      ORDER BY username LIMIT 20
    `).bind(`%${q}%`, `%${q}%`).all();
    return json({ users: rows.results || [] });
  }

  if (path === "/api/profile" && method === "PUT") {
    if (!user) return json({ error: "نیاز به ورود دارید." }, 401);
    const data = await body(request);
    const displayName = String(data?.display_name ?? user.display_name ?? "").trim().slice(0, 50);
    const bio = String(data?.bio ?? user.bio ?? "").trim().slice(0, 160);
    await env.DB.prepare(
      "UPDATE users SET display_name = ?, bio = ?, updated_at = ? WHERE id = ?"
    ).bind(displayName, bio, now(), user.id).run();
    return json({ ok: true, user: { ...user, display_name: displayName, bio } });
  }

  if (path === "/api/chats" && method === "GET") {
    if (!user) return json({ error: "نیاز به ورود دارید." }, 401);
    const rows = await env.DB.prepare(`
      SELECT c.id, c.type, c.title, c.created_at,
        (SELECT m.content FROM messages m WHERE m.chat_id=c.id ORDER BY m.id DESC LIMIT 1) AS last_message,
        (SELECT m.created_at FROM messages m WHERE m.chat_id=c.id ORDER BY m.id DESC LIMIT 1) AS last_message_at
      FROM chats c
      JOIN chat_members cm ON cm.chat_id=c.id
      WHERE cm.user_id=?
      ORDER BY COALESCE(last_message_at, c.created_at) DESC
    `).bind(user.id).all();
    return json({ chats: rows.results || [] });
  }

  if (path === "/api/chats" && method === "POST") {
    if (!user) return json({ error: "نیاز به ورود دارید." }, 401);
    const data = await body(request);
    const otherId = Number(data?.user_id);
    if (!Number.isInteger(otherId) || otherId <= 0 || otherId === user.id)
      return json({ error: "کاربر مقصد نامعتبر است." }, 400);

    const other = await env.DB.prepare("SELECT id FROM users WHERE id=?").bind(otherId).first();
    if (!other) return json({ error: "کاربر پیدا نشد." }, 404);

    const existing = await env.DB.prepare(`
      SELECT c.id FROM chats c
      JOIN chat_members a ON a.chat_id=c.id AND a.user_id=?
      JOIN chat_members b ON b.chat_id=c.id AND b.user_id=?
      WHERE c.type='direct' LIMIT 1
    `).bind(user.id, otherId).first();

    if (existing) return json({ chat_id: existing.id });

    const t = now();
    const created = await env.DB.prepare(
      "INSERT INTO chats (type, created_by, created_at) VALUES ('direct', ?, ?)"
    ).bind(user.id, t).run();
    const chatId = created.meta.last_row_id;

    await env.DB.batch([
      env.DB.prepare("INSERT INTO chat_members (chat_id,user_id,role,joined_at) VALUES (?,?,?,?)").bind(chatId,user.id,"member",t),
      env.DB.prepare("INSERT INTO chat_members (chat_id,user_id,role,joined_at) VALUES (?,?,?,?)").bind(chatId,otherId,"member",t)
    ]);
    return json({ chat_id: chatId }, 201);
  }

  const chatMatch = path.match(/^\/api\/chats\/(\d+)\/messages$/);
  if (chatMatch) {
    if (!user) return json({ error: "نیاز به ورود دارید." }, 401);
    const chatId = Number(chatMatch[1]);
    const member = await env.DB.prepare(
      "SELECT 1 FROM chat_members WHERE chat_id=? AND user_id=?"
    ).bind(chatId, user.id).first();
    if (!member) return json({ error: "دسترسی ندارید." }, 403);

    if (method === "GET") {
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 100), 1), 200);
      const rows = await env.DB.prepare(`
        SELECT m.id, m.chat_id, m.sender_id, m.content, m.message_type, m.created_at,
               u.username, u.display_name
        FROM messages m JOIN users u ON u.id=m.sender_id
        WHERE m.chat_id=? AND m.deleted_at IS NULL
        ORDER BY m.id DESC LIMIT ?
      `).bind(chatId, limit).all();
      return json({ messages: (rows.results || []).reverse() });
    }

    if (method === "POST") {
      const data = await body(request);
      const content = String(data?.content || "").trim();
      if (!content) return json({ error: "پیام خالی است." }, 400);
      if (content.length > MAX_MESSAGE_LENGTH) return json({ error: "پیام بیش از حد طولانی است." }, 400);
      const result = await env.DB.prepare(`
        INSERT INTO messages (chat_id, sender_id, content, message_type, created_at)
        VALUES (?, ?, ?, 'text', ?)
      `).bind(chatId, user.id, content, now()).run();
      return json({ ok: true, message_id: result.meta.last_row_id }, 201);
    }
  }

  if (path === "/api/stories" && method === "GET") {
    if (!user) return json({ error: "نیاز به ورود دارید." }, 401);
    await env.DB.prepare("DELETE FROM stories WHERE expires_at <= ?").bind(now()).run();
    const rows = await env.DB.prepare(`
      SELECT s.id, s.user_id, s.media_url, s.media_type, s.caption, s.created_at, s.expires_at,
             u.username, u.display_name, u.avatar
      FROM stories s JOIN users u ON u.id=s.user_id
      WHERE s.expires_at > ?
      ORDER BY s.created_at DESC
      LIMIT 100
    `).bind(now()).all();
    return json({ stories: rows.results || [] });
  }

  if (path === "/api/stories" && method === "POST") {
    if (!user) return json({ error: "نیاز به ورود دارید." }, 401);
    const data = await body(request);
    const mediaUrl = String(data?.media_url || "").trim();
    const caption = String(data?.caption || "").trim().slice(0, 200);
    if (!mediaUrl || !/^https?:\/\//i.test(mediaUrl))
      return json({ error: "برای نسخه V1 آدرس https:// تصویر را وارد کنید." }, 400);
    const t = now();
    await env.DB.prepare(`
      INSERT INTO stories (user_id, media_url, media_type, caption, created_at, expires_at)
      VALUES (?, ?, 'image', ?, ?, ?)
    `).bind(user.id, mediaUrl, caption, t, t + 86400).run();
    return json({ ok: true }, 201);
  }

  return null;
}

export default {
  async fetch(request, env) {
    try {
      const result = await route(request, env);
      if (result) return withCors(result);

      // Everything outside /api is served by the static assets binding.
      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error(error);
      return withCors(json({ error: "خطای داخلی سرور.", detail: String(error?.message || error) }, 500));
    }
  }
};
