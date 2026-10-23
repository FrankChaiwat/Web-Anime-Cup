import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { NextFunction, Request, Response } from "express";
import { pool } from "./db";

const scrypt = promisify(scryptCallback);
const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 7;

export type UserRole = "member" | "admin";
export type AuthUser = { id: number; email: string; displayName: string; role: UserRole };

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) {
    throw new Error("SESSION_SECRET ต้องมีความยาวอย่างน้อย 32 bytes");
  }
  return secret;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = await scrypt(password, salt, 64) as Buffer;
  return `${salt.toString("hex")}:${derivedKey.toString("hex")}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [saltHex, keyHex] = storedHash.split(":");
  if (!saltHex || !keyHex || !/^[a-f0-9]{32}$/i.test(saltHex) || !/^[a-f0-9]{128}$/i.test(keyHex)) {
    return false;
  }
  const expected = Buffer.from(keyHex, "hex");
  const actual = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length) as Buffer;
  return timingSafeEqual(actual, expected);
}

export function createAccessToken(user: AuthUser): string {
  const payload = Buffer.from(JSON.stringify({
    sub: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + SESSION_DURATION_SECONDS,
  })).toString("base64url");
  const signature = createHmac("sha256", getSessionSecret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const authorization = req.header("authorization") || "";
  const [scheme, token] = authorization.split(" ");
  if (scheme !== "Bearer" || !token) {
    res.status(401).json({ message: "กรุณาเข้าสู่ระบบก่อนใช้งาน" });
    return;
  }

  try {
    const [payload, signature, extra] = token.split(".");
    if (!payload || !signature || extra) {
      res.status(401).json({ message: "เซสชันไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่" });
      return;
    }
    const expected = createHmac("sha256", getSessionSecret()).update(payload).digest();
    const received = Buffer.from(signature, "base64url");
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      res.status(401).json({ message: "เซสชันไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่" });
      return;
    }

    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      sub?: unknown; email?: unknown; displayName?: unknown; role?: unknown; exp?: unknown;
    };
    if (
      !Number.isInteger(data.sub) ||
      typeof data.email !== "string" ||
      typeof data.displayName !== "string" ||
      (data.role !== "admin" && data.role !== "member") ||
      typeof data.exp !== "number" ||
      data.exp <= Math.floor(Date.now() / 1000)
    ) {
      res.status(401).json({ message: "เซสชันหมดอายุหรือไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่" });
      return;
    }
    req.user = {
      id: data.sub as number,
      email: data.email,
      displayName: data.displayName,
      role: data.role,
    };
    next();
  } catch (error) {
    if (error instanceof Error && error.message.includes("SESSION_SECRET")) {
      console.error(error);
      res.status(500).json({ message: "เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า SESSION_SECRET" });
      return;
    }
    res.status(401).json({ message: "เซสชันไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่" });
  }
}

export function optionalAuthenticate(req: Request, res: Response, next: NextFunction): void {
  if (!req.header("authorization")) {
    next();
    return;
  }
  authenticate(req, res, next);
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role !== "admin") {
    res.status(403).json({ message: "หน้านี้สำหรับผู้ดูแลระบบเท่านั้น" });
    return;
  }
  void pool.query(
    `SELECT email, display_name AS "displayName", role
     FROM users WHERE id = $1`,
    [req.user.id],
  ).then((result) => {
    const currentUser = result.rows[0];
    if (!currentUser || currentUser.role !== "admin") {
      res.status(403).json({ message: "บัญชีนี้ไม่มีสิทธิ์ผู้ดูแลระบบแล้ว" });
      return;
    }
    req.user = { ...req.user!, ...currentUser };
    next();
  }).catch((error: unknown) => {
    console.error(error);
    res.status(500).json({ message: "ตรวจสอบสิทธิ์ผู้ดูแลระบบไม่สำเร็จ" });
  });
}
