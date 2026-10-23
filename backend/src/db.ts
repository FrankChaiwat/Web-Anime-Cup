import { Pool } from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("กรุณาตั้งค่า DATABASE_URL ในไฟล์ backend/.env");
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS quizzes (
      id SERIAL PRIMARY KEY,
      title VARCHAR(120) NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category VARCHAR(60) NOT NULL DEFAULT 'ทั่วไป',
      cover_image_url TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      play_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS quiz_options (
      id SERIAL PRIMARY KEY,
      quiz_id INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
      name VARCHAR(120) NOT NULL,
      image_url TEXT NOT NULL DEFAULT '',
      position INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(254) NOT NULL UNIQUE,
      display_name VARCHAR(80) NOT NULL,
      password_hash TEXT NOT NULL,
      role VARCHAR(10) NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS site_settings (
      key VARCHAR(80) PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS quiz_plays (
      id SERIAL PRIMARY KEY,
      quiz_id INTEGER REFERENCES quizzes(id) ON DELETE SET NULL,
      winner_option_id INTEGER REFERENCES quiz_options(id) ON DELETE SET NULL,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      winner_name VARCHAR(120),
      winner_image_url TEXT,
      quiz_title VARCHAR(120),
      played_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    ALTER TABLE quizzes
      ADD COLUMN IF NOT EXISTS cover_image_url TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

    ALTER TABLE quiz_plays
      DROP CONSTRAINT IF EXISTS quiz_plays_quiz_id_fkey;
    ALTER TABLE quiz_plays
      ALTER COLUMN quiz_id DROP NOT NULL,
      ADD CONSTRAINT quiz_plays_quiz_id_fkey
        FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE SET NULL;

    ALTER TABLE quiz_plays
      ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS winner_name VARCHAR(120),
      ADD COLUMN IF NOT EXISTS winner_image_url TEXT,
      ADD COLUMN IF NOT EXISTS quiz_title VARCHAR(120);

    UPDATE quiz_plays AS plays
    SET winner_name = COALESCE(plays.winner_name, options.name),
        winner_image_url = COALESCE(plays.winner_image_url, options.image_url)
    FROM quiz_options AS options
    WHERE plays.winner_option_id = options.id
      AND (plays.winner_name IS NULL OR plays.winner_image_url IS NULL);

    UPDATE quiz_plays AS plays
    SET quiz_title = quizzes.title
    FROM quizzes
    WHERE plays.quiz_id = quizzes.id AND plays.quiz_title IS NULL;
  `);

  const count = await pool.query("SELECT COUNT(*)::int AS count FROM quizzes");
  if (count.rows[0].count === 0) {
    const sample = await pool.query(
      `INSERT INTO quizzes (title, description, category)
       VALUES ($1, $2, $3) RETURNING id`,
      [
        "Anime World Cup: เลือกตัวละครที่ชอบ",
        "ตัวอย่างควิซ เลือกตัวละครที่คุณชอบที่สุดในแต่ละคู่",
        "Anime",
      ]
    );
    const quizId = sample.rows[0].id as number;
    const options = [
      ["Naruto Uzumaki", "https://placehold.co/600x600/ffb4d2/352047?text=Naruto"],
      ["Monkey D. Luffy", "https://placehold.co/600x600/ffd59e/352047?text=Luffy"],
      ["Sailor Moon", "https://placehold.co/600x600/b9d8ff/352047?text=Sailor+Moon"],
      ["Anya Forger", "https://placehold.co/600x600/d9c2ff/352047?text=Anya"],
      ["Gojo Satoru", "https://placehold.co/600x600/bbe9db/352047?text=Gojo"],
      ["Nezuko Kamado", "https://placehold.co/600x600/ffb4d2/352047?text=Nezuko"],
      ["Goku", "https://placehold.co/600x600/ffd59e/352047?text=Goku"],
      ["Mikasa Ackerman", "https://placehold.co/600x600/b9d8ff/352047?text=Mikasa"]
    ];
    for (let i = 0; i < options.length; i++) {
      await pool.query(
        "INSERT INTO quiz_options (quiz_id, name, image_url, position) VALUES ($1, $2, $3, $4)",
        [quizId, options[i][0], options[i][1], i]
      );
    }
  }
}
