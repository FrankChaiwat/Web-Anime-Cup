import "dotenv/config";
import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import multer from "multer";
import { randomUUID } from "crypto";
import { mkdir, readFile, unlink } from "fs/promises";
import path from "path";
import { pool, initializeDatabase } from "./db";
import { authenticate, AuthUser, createAccessToken, hashPassword, optionalAuthenticate, requireAdmin, verifyPassword } from "./auth";

const app = express();
const port = Number(process.env.PORT || 5000);
const uploadsDirectory = path.resolve(__dirname, "..", "uploads");

app.use(cors({ origin: process.env.CLIENT_URL || "http://localhost:5173" }));
app.use(express.json({ limit: "1mb" }));
app.use("/uploads", express.static(uploadsDirectory, {
  setHeaders: (res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  },
}));

type QuizOptionInput = { id?: number; name?: string; imageUrl?: string };
type QuizBody = {
  title?: string;
  description?: string;
  category?: string;
  coverImageUrl?: string;
  options?: QuizOptionInput[];
};
type NormalizedQuizOption = { id?: number; name: string; imageUrl: string };

const imageExtensions: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};
function getQuizUploadFolder(title: string): string {
  const slug = title.normalize("NFKC").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return `quiz-${slug || "untitled"}`;
}

function getUserUploadFolder(userId: number): string {
  return `user-${userId}`;
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, callback) => {
      const title = typeof req.body?.quizTitle === "string" ? req.body.quizTitle.trim() : "";
      if (title.length < 3 || title.length > 120) {
        callback(new Error("กรุณากรอกชื่อควิซอย่างน้อย 3 ตัวอักษรก่อนอัปโหลดรูป"), uploadsDirectory);
        return;
      }
      const directory = path.join(
        uploadsDirectory,
        getUserUploadFolder(req.user!.id),
        getQuizUploadFolder(title),
      );
      void mkdir(directory, { recursive: true }).then(
        () => callback(null, directory),
        (error: Error) => callback(error, directory),
      );
    },
    filename: (_req, file, callback) => callback(null, `${randomUUID()}${imageExtensions[file.mimetype] || ".tmp"}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!imageExtensions[file.mimetype]) {
      callback(new Error("รองรับเฉพาะไฟล์ภาพ JPEG, PNG และ WebP"));
      return;
    }
    callback(null, true);
  },
});

function parseImageUpload(req: Request, res: Response, next: NextFunction): void {
  upload.single("image")(req, res, (error: unknown) => {
    if (!error) {
      next();
      return;
    }
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ message: "ไฟล์ภาพต้องมีขนาดไม่เกิน 5 MB" });
      return;
    }
    res.status(400).json({ message: error instanceof Error ? error.message : "อัปโหลดไฟล์ไม่สำเร็จ" });
  });
}

function publicUser(user: AuthUser) {
  return { id: user.id, email: user.email, displayName: user.displayName, role: user.role };
}

function sendSession(res: Response, user: AuthUser, status = 200) {
  res.status(status).json({ user: publicUser(user), token: createAccessToken(user) });
}

function normalizeQuizBody(body: QuizBody, res: Response): {
  title: string;
  description: string;
  category: string;
  coverImageUrl: string;
  options: NormalizedQuizOption[];
} | null {
  const title = String(body.title || "").trim();
  const description = String(body.description || "").trim();
  const category = String(body.category || "ทั่วไป").trim().slice(0, 60);
  const coverImageUrl = String(body.coverImageUrl || "").trim().slice(0, 2000);
  const options = Array.isArray(body.options) ? body.options : [];
  if (title.length < 3 || title.length > 120) {
    res.status(400).json({ message: "ชื่อควิซต้องมีความยาว 3–120 ตัวอักษร" });
    return null;
  }
  if (options.length < 2 || options.length > 64) {
    res.status(400).json({ message: "ควิซต้องมีตัวเลือกอย่างน้อย 2 และไม่เกิน 64 ตัวเลือก" });
    return null;
  }
  const normalized = options.map((option) => ({
    id: option.id,
    name: String(option.name || "").trim().slice(0, 120),
    imageUrl: String(option.imageUrl || "").trim().slice(0, 2000),
  }));
  if (normalized.some((option) => !option.name)) {
    res.status(400).json({ message: "กรุณาใส่ชื่อให้ตัวเลือกทุกข้อ" });
    return null;
  }
  if (normalized.some((option) => option.imageUrl && !(/^(https?:\/\/|\/uploads\/(?:user-\d+\/)?(?:quiz-[\p{L}\p{N}-]+\/)?[a-f0-9-]+\.(jpg|png|webp)$)/iu.test(option.imageUrl)))) {
    res.status(400).json({ message: "รูปภาพต้องเป็น URL http(s) หรือภาพที่อัปโหลดไว้" });
    return null;
  }
  if (coverImageUrl && !(/^(https?:\/\/|\/uploads\/(?:user-\d+\/)?(?:quiz-[\p{L}\p{N}-]+\/)?[a-f0-9-]+\.(jpg|png|webp)$)/iu.test(coverImageUrl))) {
    res.status(400).json({ message: "รูปปกต้องเป็น URL http(s) หรือภาพที่อัปโหลดไว้" });
    return null;
  }
  return { title, description, category: category || "ทั่วไป", coverImageUrl, options: normalized };
}

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", message: "Quiz World Cup API พร้อมใช้งาน" });
});

app.post("/api/auth/register", async (req: Request, res: Response) => {
  const displayName = String(req.body?.displayName || "").trim();
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  if (displayName.length < 2 || displayName.length > 80) {
    res.status(400).json({ message: "ชื่อที่แสดงต้องมีความยาว 2–80 ตัวอักษร" });
    return;
  }
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ message: "กรุณากรอกอีเมลให้ถูกต้อง" });
    return;
  }
  if (password.length < 8 || password.length > 128) {
    res.status(400).json({ message: "รหัสผ่านต้องมีความยาว 8–128 ตัวอักษร" });
    return;
  }
  try {
    const passwordHash = await hashPassword(password);
    const result = await pool.query(
      `INSERT INTO users (email, display_name, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, email, display_name AS "displayName", role`,
      [email, displayName, passwordHash],
    );
    sendSession(res, { ...result.rows[0], role: result.rows[0].role as AuthUser["role"] }, 201);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      res.status(409).json({ message: "อีเมลนี้ถูกใช้งานแล้ว" });
      return;
    }
    console.error(error);
    res.status(500).json({ message: "สมัครสมาชิกไม่สำเร็จ" });
  }
});

app.post("/api/auth/login", async (req: Request, res: Response) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  if (!email || !password) {
    res.status(400).json({ message: "กรุณากรอกอีเมลและรหัสผ่าน" });
    return;
  }
  try {
    const result = await pool.query(
      `SELECT id, email, display_name AS "displayName", password_hash, role
       FROM users WHERE email = $1`,
      [email],
    );
    const row = result.rows[0];
    if (!row || !(await verifyPassword(password, row.password_hash))) {
      res.status(401).json({ message: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" });
      return;
    }
    sendSession(res, { id: row.id, email: row.email, displayName: row.displayName, role: row.role });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "เข้าสู่ระบบไม่สำเร็จ" });
  }
});

app.get("/api/auth/me", authenticate, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT id, email, display_name AS "displayName", role
       FROM users WHERE id = $1`,
      [req.user!.id],
    );
    if (!result.rowCount) {
      res.status(401).json({ message: "ไม่พบบัญชีผู้ใช้นี้ กรุณาเข้าสู่ระบบใหม่" });
      return;
    }
    const user: AuthUser = result.rows[0];
    res.json({ user: publicUser(user), token: createAccessToken(user) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "ตรวจสอบบัญชีผู้ใช้ไม่สำเร็จ" });
  }
});

app.get("/api/profile", authenticate, async (req: Request, res: Response) => {
  try {
    const [favorites, recentPlays, ownedQuizzes] = await Promise.all([
      pool.query(
        `SELECT COALESCE(winner_option_id::text, 'snapshot:' || LOWER(winner_name) || ':' || COALESCE(winner_image_url, '')) AS id,
                (ARRAY_AGG(winner_name ORDER BY played_at DESC))[1] AS name,
                (ARRAY_AGG(COALESCE(winner_image_url, '') ORDER BY played_at DESC))[1] AS "imageUrl",
                COUNT(*)::int AS "playCount", MAX(played_at) AS "lastPlayed"
         FROM quiz_plays
         WHERE user_id = $1 AND winner_name IS NOT NULL
         GROUP BY 1
         ORDER BY "playCount" DESC, "lastPlayed" DESC
         LIMIT 10`,
        [req.user!.id],
      ),
      pool.query(
        `SELECT plays.quiz_id AS "quizId", COALESCE(plays.quiz_title, quizzes.title) AS "quizTitle",
                plays.winner_name AS "winnerName", COALESCE(plays.winner_image_url, '') AS "winnerImageUrl",
                plays.played_at AS "playedAt"
         FROM quiz_plays AS plays
         LEFT JOIN quizzes ON quizzes.id = plays.quiz_id
         WHERE plays.user_id = $1
         ORDER BY plays.played_at DESC
         LIMIT 20`,
        [req.user!.id],
      ),
      pool.query(
        `SELECT quizzes.id, quizzes.title, quizzes.description, quizzes.category,
                quizzes.cover_image_url AS "coverImageUrl", quizzes.created_at,
                quizzes.play_count, quizzes.owner_user_id AS "ownerUserId",
                (SELECT COUNT(*)::int FROM quiz_options WHERE quiz_id = quizzes.id) AS option_count
         FROM quizzes
         WHERE quizzes.owner_user_id = $1
         ORDER BY quizzes.created_at DESC, quizzes.id DESC`,
        [req.user!.id],
      ),
    ]);
    res.json({
      user: publicUser(req.user!),
      favorites: favorites.rows,
      recentPlays: recentPlays.rows,
      ownedQuizzes: ownedQuizzes.rows,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "โหลดข้อมูลโปรไฟล์ไม่สำเร็จ" });
  }
});

app.get("/api/admin/users", authenticate, requireAdmin, async (req: Request, res: Response) => {
  const search = String(req.query.search || "").trim().slice(0, 254);
  try {
    const result = await pool.query(
      `SELECT id, email, display_name AS "displayName", role, created_at AS "createdAt"
       FROM users
       WHERE ($1 = '' OR POSITION(LOWER($1) IN LOWER(email)) > 0)
       ORDER BY created_at DESC, id DESC
       LIMIT 100`,
      [search],
    );
    res.json({ users: result.rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "โหลดรายชื่อผู้ใช้ไม่สำเร็จ" });
  }
});

app.get("/api/admin/users/:id", authenticate, requireAdmin, async (req: Request<{ id: string }>, res: Response) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId) || userId < 1) {
    res.status(400).json({ message: "รหัสผู้ใช้ไม่ถูกต้อง" });
    return;
  }
  try {
    const result = await pool.query(
      `SELECT id, email, display_name AS "displayName", role, created_at AS "createdAt"
       FROM users WHERE id = $1`,
      [userId],
    );
    if (!result.rowCount) {
      res.status(404).json({ message: "ไม่พบผู้ใช้นี้" });
      return;
    }
    res.json({ user: result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "โหลดข้อมูลผู้ใช้ไม่สำเร็จ" });
  }
});

app.put("/api/admin/users/:id", authenticate, requireAdmin, async (req: Request<{ id: string }>, res: Response) => {
  const userId = Number(req.params.id);
  const email = String(req.body?.email || "").trim().toLowerCase();
  const displayName = String(req.body?.displayName || "").trim();
  const role = req.body?.role;
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!Number.isInteger(userId) || userId < 1) {
    res.status(400).json({ message: "รหัสผู้ใช้ไม่ถูกต้อง" });
    return;
  }
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ message: "กรุณากรอกอีเมลให้ถูกต้อง" });
    return;
  }
  if (displayName.length < 2 || displayName.length > 80) {
    res.status(400).json({ message: "ชื่อต้องมีความยาว 2–80 ตัวอักษร" });
    return;
  }
  if (role !== "member" && role !== "admin") {
    res.status(400).json({ message: "ระดับสิทธิ์ผู้ใช้ไม่ถูกต้อง" });
    return;
  }
  if (password && (password.length < 8 || password.length > 128)) {
    res.status(400).json({ message: "รหัสผ่านใหม่ต้องมีความยาว 8–128 ตัวอักษร" });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const admins = await client.query("SELECT id FROM users WHERE role = 'admin' FOR UPDATE");
    const target = await client.query(
      "SELECT id, role FROM users WHERE id = $1 FOR UPDATE",
      [userId],
    );
    if (!target.rowCount) {
      await client.query("ROLLBACK");
      res.status(404).json({ message: "ไม่พบผู้ใช้นี้" });
      return;
    }
    if (req.user!.id === userId && role !== "admin") {
      await client.query("ROLLBACK");
      res.status(400).json({ message: "ไม่สามารถลดสิทธิ์บัญชีแอดมินที่กำลังใช้งานได้" });
      return;
    }
    if (target.rows[0].role === "admin" && role !== "admin" && admins.rows.length <= 1) {
      await client.query("ROLLBACK");
      res.status(400).json({ message: "ไม่สามารถลดสิทธิ์แอดมินคนสุดท้ายได้" });
      return;
    }
    const values = password
      ? [email, displayName, role, await hashPassword(password), userId]
      : [email, displayName, role, userId];
    const result = await client.query(
      password
        ? `UPDATE users SET email = $1, display_name = $2, role = $3, password_hash = $4
           WHERE id = $5
           RETURNING id, email, display_name AS "displayName", role, created_at AS "createdAt"`
        : `UPDATE users SET email = $1, display_name = $2, role = $3
           WHERE id = $4
           RETURNING id, email, display_name AS "displayName", role, created_at AS "createdAt"`,
      values,
    );
    await client.query("COMMIT");
    const updatedUser: AuthUser = {
      id: result.rows[0].id,
      email: result.rows[0].email,
      displayName: result.rows[0].displayName,
      role: result.rows[0].role,
    };
    res.json({
      user: result.rows[0],
      ...(req.user!.id === userId ? { token: createAccessToken(updatedUser) } : {}),
    });
  } catch (error) {
    await client.query("ROLLBACK");
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      res.status(409).json({ message: "อีเมลนี้ถูกใช้งานแล้ว" });
      return;
    }
    console.error(error);
    res.status(500).json({ message: "บันทึกข้อมูลผู้ใช้ไม่สำเร็จ" });
  } finally {
    client.release();
  }
});

app.delete("/api/admin/users/:id", authenticate, requireAdmin, async (req: Request<{ id: string }>, res: Response) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId) || userId < 1) {
    res.status(400).json({ message: "รหัสผู้ใช้ไม่ถูกต้อง" });
    return;
  }
  if (req.user!.id === userId) {
    res.status(400).json({ message: "ไม่สามารถลบบัญชีแอดมินที่กำลังใช้งานได้" });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const admins = await client.query("SELECT id FROM users WHERE role = 'admin' FOR UPDATE");
    const target = await client.query("SELECT id, role FROM users WHERE id = $1 FOR UPDATE", [userId]);
    if (!target.rowCount) {
      await client.query("ROLLBACK");
      res.status(404).json({ message: "ไม่พบผู้ใช้นี้" });
      return;
    }
    if (target.rows[0].role === "admin" && admins.rows.length <= 1) {
      await client.query("ROLLBACK");
      res.status(400).json({ message: "ไม่สามารถลบแอดมินคนสุดท้ายได้" });
      return;
    }
    await client.query("DELETE FROM users WHERE id = $1", [userId]);
    await client.query("COMMIT");
    res.json({ message: "ลบผู้ใช้สำเร็จ" });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error);
    res.status(500).json({ message: "ลบผู้ใช้ไม่สำเร็จ" });
  } finally {
    client.release();
  }
});

app.post("/api/uploads", authenticate, parseImageUpload, async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ message: "กรุณาเลือกไฟล์ภาพ" });
    return;
  }
  try {
    const signature = await readFile(file.path);
    const isJpeg = signature.length >= 3 && signature[0] === 0xff && signature[1] === 0xd8 && signature[2] === 0xff;
    const isPng = signature.length >= 8 && signature.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const isWebp = signature.length >= 12 && signature.toString("ascii", 0, 4) === "RIFF" && signature.toString("ascii", 8, 12) === "WEBP";
    const valid = (file.mimetype === "image/jpeg" && isJpeg) ||
      (file.mimetype === "image/png" && isPng) ||
      (file.mimetype === "image/webp" && isWebp);
    if (!valid) {
      await unlink(file.path);
      res.status(400).json({ message: "เนื้อหาไฟล์ไม่ตรงกับชนิดภาพที่รองรับ" });
      return;
    }
    const userFolder = getUserUploadFolder(req.user!.id);
    const quizFolder = getQuizUploadFolder(String(req.body.quizTitle));
    res.status(201).json({
      imageUrl: `/uploads/${userFolder}/${encodeURIComponent(quizFolder)}/${file.filename}`,
      message: "อัปโหลดภาพสำเร็จ",
    });
  } catch (error) {
    console.error(error);
    await unlink(file.path).catch((cleanupError: NodeJS.ErrnoException) => {
      if (cleanupError.code !== "ENOENT") console.error(cleanupError);
    });
    res.status(500).json({ message: "ตรวจสอบไฟล์ภาพไม่สำเร็จ" });
  }
});

app.get("/api/site-settings/homepage", async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      "SELECT key, value FROM site_settings WHERE key IN ('hero_image_url', 'hero_background_url')",
    );
    const settings = Object.fromEntries(result.rows.map((row) => [row.key, row.value]));
    res.json({
      heroImageUrl: settings.hero_image_url || "",
      heroBackgroundUrl: settings.hero_background_url || "",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "โหลดภาพหน้าแรกไม่สำเร็จ" });
  }
});

app.put("/api/site-settings/homepage", authenticate, requireAdmin, async (req: Request, res: Response) => {
  const heroImageUrl = typeof req.body?.heroImageUrl === "string" ? req.body.heroImageUrl.trim() : "";
  const heroBackgroundUrl = typeof req.body?.heroBackgroundUrl === "string" ? req.body.heroBackgroundUrl.trim() : "";
  const hasHeroImage = typeof req.body?.heroImageUrl === "string";
  const hasHeroBackground = typeof req.body?.heroBackgroundUrl === "string";
  if (!hasHeroImage && !hasHeroBackground) {
    res.status(400).json({ message: "ไม่พบการตั้งค่าภาพที่ต้องการบันทึก" });
    return;
  }
  const validUploadUrl = /^(https?:\/\/[^/]+)?\/uploads\/(?:user-\d+\/)?(?:quiz-(?:[\p{L}\p{N}-]|%[a-f0-9]{2})+\/)?[a-f0-9-]+\.(jpg|png|webp)$/iu;
  if ((heroImageUrl && !validUploadUrl.test(heroImageUrl)) || (heroBackgroundUrl && !validUploadUrl.test(heroBackgroundUrl))) {
    res.status(400).json({ message: "กรุณาเลือกรูปที่อัปโหลดไว้ในระบบ" });
    return;
  }
  try {
    const settingsToSave: Array<[string, string]> = [];
    if (hasHeroImage) settingsToSave.push(["hero_image_url", heroImageUrl]);
    if (hasHeroBackground) settingsToSave.push(["hero_background_url", heroBackgroundUrl]);
    for (const [key, value] of settingsToSave) {
      await pool.query(
        `INSERT INTO site_settings (key, value)
         VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [key, value],
      );
    }
    res.json({
      ...(hasHeroImage ? { heroImageUrl } : {}),
      ...(hasHeroBackground ? { heroBackgroundUrl } : {}),
      message: "บันทึกการตั้งค่าภาพหน้าแรกสำเร็จ",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "บันทึกรูปหน้าแรกไม่สำเร็จ" });
  }
});

app.get("/api/quizzes", async (req: Request, res: Response) => {
  try {
    const search = String(req.query.search || "").trim();
    const result = await pool.query(
      `SELECT q.id, q.title, q.description, q.category, q.cover_image_url AS "coverImageUrl", q.created_at,
              q.play_count, COUNT(o.id)::int AS option_count
       FROM quizzes q
       LEFT JOIN quiz_options o ON o.quiz_id = q.id
       WHERE ($1 = '' OR q.title ILIKE $2 OR q.category ILIKE $2)
       GROUP BY q.id
       ORDER BY q.created_at DESC`,
      [search, `%${search}%`]
    );
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "โหลดรายการควิซไม่สำเร็จ" });
  }
});

app.get("/api/quizzes/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ message: "รหัสควิซไม่ถูกต้อง" });
    return;
  }
  try {
    const quizResult = await pool.query(
      `SELECT id, title, description, category, cover_image_url AS "coverImageUrl", created_at, play_count
       FROM quizzes WHERE id = $1`,
      [id]
    );
    if (quizResult.rowCount === 0) {
      res.status(404).json({ message: "ไม่พบควิซนี้" });
      return;
    }
    const optionsResult = await pool.query(
      `SELECT id, name, image_url AS "imageUrl", position
       FROM quiz_options WHERE quiz_id = $1 ORDER BY position, id`,
      [id]
    );
    res.json({ ...quizResult.rows[0], options: optionsResult.rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "โหลดควิซไม่สำเร็จ" });
  }
});

app.post("/api/quizzes", authenticate, async (req: Request<{}, {}, QuizBody>, res: Response) => {
  const payload = normalizeQuizBody(req.body, res);
  if (!payload) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const quizResult = await client.query(
      `INSERT INTO quizzes (title, description, category, cover_image_url, owner_user_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [payload.title, payload.description, payload.category, payload.coverImageUrl, req.user!.id]
    );
    const quizId = quizResult.rows[0].id as number;
    for (let i = 0; i < payload.options.length; i++) {
      await client.query(
        `INSERT INTO quiz_options (quiz_id, name, image_url, position)
         VALUES ($1, $2, $3, $4)`,
        [quizId, payload.options[i].name, payload.options[i].imageUrl, i]
      );
    }
    await client.query("COMMIT");
    res.status(201).json({ id: quizId, message: "สร้างควิซสำเร็จ" });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error);
    res.status(500).json({ message: "สร้างควิซไม่สำเร็จ" });
  } finally {
    client.release();
  }
});

app.put("/api/quizzes/:id", authenticate, async (req: Request<{ id: string }, {}, QuizBody>, res: Response) => {
  const quizId = Number(req.params.id);
  if (!Number.isInteger(quizId) || quizId < 1) {
    res.status(400).json({ message: "รหัสควิซไม่ถูกต้อง" });
    return;
  }
  const payload = normalizeQuizBody(req.body, res);
  if (!payload) return;

  const optionIds = payload.options.flatMap((option) => option.id === undefined ? [] : [option.id]);
  if (optionIds.some((id) => !Number.isInteger(id) || id < 1) || new Set(optionIds).size !== optionIds.length) {
    res.status(400).json({ message: "รหัสตัวเลือกไม่ถูกต้องหรือซ้ำกัน" });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const quizOwner = await client.query(
      "SELECT owner_user_id FROM quizzes WHERE id = $1 FOR UPDATE",
      [quizId],
    );
    if (!quizOwner.rowCount) {
      await client.query("ROLLBACK");
      res.status(404).json({ message: "ไม่พบควิซนี้" });
      return;
    }
    const actor = await client.query("SELECT role FROM users WHERE id = $1", [req.user!.id]);
    const isOwner = quizOwner.rows[0].owner_user_id === req.user!.id;
    const isAdmin = actor.rows[0]?.role === "admin";
    if (!isOwner && !isAdmin) {
      await client.query("ROLLBACK");
      res.status(403).json({ message: "คุณแก้ไขได้เฉพาะควิซของตัวเอง" });
      return;
    }
    const quizResult = await client.query("UPDATE quizzes SET title = $1, description = $2, category = $3, cover_image_url = $4 WHERE id = $5 RETURNING id", [
      payload.title, payload.description, payload.category, payload.coverImageUrl, quizId,
    ]);
    if (!quizResult.rowCount) {
      await client.query("ROLLBACK");
      res.status(404).json({ message: "ไม่พบควิซนี้" });
      return;
    }

    const existingOptions = await client.query("SELECT id FROM quiz_options WHERE quiz_id = $1 FOR UPDATE", [quizId]);
    const existingIds = new Set<number>(existingOptions.rows.map((option) => option.id));
    if (optionIds.some((id) => !existingIds.has(id))) {
      await client.query("ROLLBACK");
      res.status(400).json({ message: "พบตัวเลือกที่ไม่ได้อยู่ในควิซนี้" });
      return;
    }

    const retainedIds: number[] = [];
    for (let position = 0; position < payload.options.length; position++) {
      const option = payload.options[position];
      if (option.id !== undefined) {
        await client.query(
          "UPDATE quiz_options SET name = $1, image_url = $2, position = $3 WHERE id = $4 AND quiz_id = $5",
          [option.name, option.imageUrl, position, option.id, quizId],
        );
        retainedIds.push(option.id);
      } else {
        const inserted = await client.query(
          "INSERT INTO quiz_options (quiz_id, name, image_url, position) VALUES ($1, $2, $3, $4) RETURNING id",
          [quizId, option.name, option.imageUrl, position],
        );
        retainedIds.push(inserted.rows[0].id);
      }
    }
    await client.query("DELETE FROM quiz_options WHERE quiz_id = $1 AND NOT (id = ANY($2::int[]))", [quizId, retainedIds]);
    await client.query("COMMIT");
    res.json({ id: quizId, message: "บันทึกการแก้ไขควิซสำเร็จ" });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error);
    res.status(500).json({ message: "แก้ไขควิซไม่สำเร็จ" });
  } finally {
    client.release();
  }
});

app.delete("/api/quizzes/:id", authenticate, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ message: "รหัสควิซไม่ถูกต้อง" });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const quizOwner = await client.query(
      "SELECT owner_user_id FROM quizzes WHERE id = $1 FOR UPDATE",
      [id],
    );
    if (!quizOwner.rowCount) {
      await client.query("ROLLBACK");
      res.status(404).json({ message: "ไม่พบควิซนี้" });
      return;
    }
    const actor = await client.query("SELECT role FROM users WHERE id = $1", [req.user!.id]);
    const isOwner = quizOwner.rows[0].owner_user_id === req.user!.id;
    const isAdmin = actor.rows[0]?.role === "admin";
    if (!isOwner && !isAdmin) {
      await client.query("ROLLBACK");
      res.status(403).json({ message: "คุณลบได้เฉพาะควิซของตัวเอง" });
      return;
    }
    await client.query("DELETE FROM quizzes WHERE id = $1", [id]);
    await client.query("COMMIT");
    res.json({ message: "ลบควิซสำเร็จ" });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error);
    res.status(500).json({ message: "ลบควิซไม่สำเร็จ" });
  } finally {
    client.release();
  }
});

app.post("/api/quizzes/:id/plays", optionalAuthenticate, async (req: Request, res: Response) => {
  const quizId = Number(req.params.id);
  const winnerOptionId = Number(req.body?.winnerOptionId);
  if (!Number.isInteger(quizId) || quizId < 1 || !Number.isInteger(winnerOptionId)) {
    res.status(400).json({ message: "ข้อมูลผลการเล่นไม่ถูกต้อง" });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const winner = await client.query(
      `SELECT options.id, options.name, options.image_url, quizzes.title AS quiz_title
       FROM quiz_options AS options
       JOIN quizzes ON quizzes.id = options.quiz_id
       WHERE options.id = $1 AND options.quiz_id = $2`,
      [winnerOptionId, quizId]
    );
    if (winner.rowCount === 0) {
      await client.query("ROLLBACK");
      res.status(400).json({ message: "ตัวเลือกผู้ชนะไม่อยู่ในควิซนี้" });
      return;
    }
    const chosen = winner.rows[0];
    await client.query(
      `INSERT INTO quiz_plays
         (quiz_id, winner_option_id, user_id, winner_name, winner_image_url, quiz_title)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [quizId, winnerOptionId, req.user?.id ?? null, chosen.name, chosen.image_url, chosen.quiz_title],
    );
    await client.query("UPDATE quizzes SET play_count = play_count + 1 WHERE id = $1", [quizId]);
    await client.query("COMMIT");
    res.status(201).json({ message: "บันทึกผลการเล่นแล้ว" });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error);
    res.status(500).json({ message: "บันทึกผลการเล่นไม่สำเร็จ" });
  } finally {
    client.release();
  }
});

app.use((_req, res) => res.status(404).json({ message: "ไม่พบ API ที่เรียก" }));

async function start() {
  try {
    if (!process.env.SESSION_SECRET || Buffer.byteLength(process.env.SESSION_SECRET) < 32) {
      throw new Error("กรุณาตั้งค่า SESSION_SECRET ให้มีความยาวอย่างน้อย 32 bytes");
    }
    await initializeDatabase();
    const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (Boolean(adminEmail) !== Boolean(adminPassword)) {
      throw new Error("ต้องกำหนด ADMIN_EMAIL และ ADMIN_PASSWORD พร้อมกัน");
    }
    if (adminEmail && adminPassword) {
      if (adminEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
        throw new Error("ADMIN_EMAIL ต้องเป็นอีเมลที่ถูกต้อง");
      }
      if (adminPassword.length < 12 || adminPassword.length > 128) {
        throw new Error("ADMIN_PASSWORD ต้องมีความยาว 12–128 ตัวอักษร");
      }
      const passwordHash = await hashPassword(adminPassword);
      await pool.query(
        `INSERT INTO users (email, display_name, password_hash, role)
         VALUES ($1, $2, $3, 'admin')
         ON CONFLICT (email) DO UPDATE SET
           display_name = EXCLUDED.display_name,
           password_hash = EXCLUDED.password_hash,
           role = 'admin'`,
        [adminEmail, "ผู้ดูแลระบบ", passwordHash],
      );
    }
    app.listen(port, () => console.log(`API running: http://localhost:${port}`));
  } catch (error) {
    console.error("เริ่มเซิร์ฟเวอร์ไม่สำเร็จ ตรวจสอบ DATABASE_URL และ PostgreSQL", error);
    process.exit(1);
  }
}

void start();
