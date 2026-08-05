import crypto from "crypto";
import { getRequest, setResponseHeader } from "@tanstack/react-start/server";
import { getDb } from "./mongo.server";

export type UserDoc = {
    _id: string;
    email: string;
    passwordHash: string;
    createdAt: number;
};

export type SessionDoc = {
    _id: string; // token UUID
    userId: string;
    expiresAt: number;
};

export function hashPassword(password: string): string {
    const salt = "verticut_salt_secret_key_1337";
    return crypto.pbkdf2Sync(password, salt, 1000, 64, "sha512").toString("hex");
}

export async function getAuthUser(): Promise<UserDoc | null> {
    let req;
    try {
        req = getRequest();
    } catch {
        return null; // not in a request context (SSR / build environment)
    }
    const cookies = req.headers.get("cookie") || "";
    const match = cookies.match(/(?:^|; )sessionToken=([^;]*)/);
    if (!match) return null;
    const token = match[1];

    const db = await getDb();
    const session = await db.collection<SessionDoc>("sessions").findOne({ _id: token });
    if (!session || Date.now() > (session.expiresAt as number)) {
        if (session) {
            await db.collection<SessionDoc>("sessions").deleteOne({ _id: token });
        }
        return null;
    }
    return db.collection<UserDoc>("users").findOne({ _id: session.userId });
}

export async function createSession(userId: string): Promise<string> {
    const token = crypto.randomUUID();
    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days
    const db = await getDb();
    await db.collection<SessionDoc>("sessions").insertOne({
        _id: token,
        userId,
        expiresAt,
    });

    setResponseHeader(
        "Set-Cookie",
        `sessionToken=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`
    );
    return token;
}

export async function clearSession(): Promise<void> {
    let req;
    try {
        req = getRequest();
    } catch {
        return;
    }
    const cookies = req.headers.get("cookie") || "";
    const match = cookies.match(/(?:^|; )sessionToken=([^;]*)/);
    if (match) {
        const token = match[1];
        const db = await getDb();
        await db.collection<SessionDoc>("sessions").deleteOne({ _id: token });
    }

    setResponseHeader(
        "Set-Cookie",
        `sessionToken=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
    );
}

export async function requireAuthUser(): Promise<UserDoc> {
    const user = await getAuthUser();
    if (!user) {
        throw new Error("Unauthorized: Please sign in to continue");
    }
    return user;
}
