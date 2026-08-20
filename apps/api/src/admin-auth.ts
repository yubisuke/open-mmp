import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Pool } from "pg";
import { withTenant } from "@open-mmp/runtime";

export type AdminIdentity = { keyId: string; tenantId: string };
export type AppAdminIdentity = AdminIdentity & { appId: string };

function keyId(key: string): string {
  return `key:${createHash("sha256").update(key).digest("hex").slice(0, 32)}`;
}

function verifier(key: string, salt: Buffer): string {
  return scryptSync(key, salt, 32, { N: 16_384, r: 8, p: 1 }).toString("hex");
}

export async function ensureAdminKeys(
  pool: Pool,
  scope: { tenantId: string; appId: string },
  keys: readonly string[],
  now = new Date().toISOString(),
): Promise<string[]> {
  const unique = [...new Set(keys.filter(Boolean))];
  if (unique.length < 1 || unique.length > 2) throw new Error("one or two admin keys must be configured");
  return withTenant(pool, scope.tenantId, async (client) => {
    await client.query(
      `INSERT INTO control.apps (tenant_id, app_id, created_at)
       VALUES ($1,$2,$3) ON CONFLICT (tenant_id, app_id) DO NOTHING`,
      [scope.tenantId, scope.appId, now],
    );
    const identifiers: string[] = [];
    for (const key of unique) {
      if (Buffer.byteLength(key, "utf8") < 32) throw new Error("admin keys must contain at least 32 bytes");
      const id = keyId(key);
      identifiers.push(id);
      const salt = randomBytes(16);
      await client.query(
        `INSERT INTO control.admin_keys (
          key_id, tenant_id, app_id, scrypt_salt, scrypt_digest, created_at
        ) VALUES ($1,$2,NULL,$3,$4,$5) ON CONFLICT (key_id) DO NOTHING`,
        [id, scope.tenantId, salt.toString("hex"), verifier(key, salt), now],
      );
      await client.query(
        `INSERT INTO control.admin_key_states (
          key_id, tenant_id, app_id, status, changed_at, artifact
        ) VALUES ($1,$2,NULL,'active',$3,$4::jsonb)
        ON CONFLICT (key_id, status) DO NOTHING`,
        [id, scope.tenantId, now, JSON.stringify({ key_id: id, status: "active", changed_at: now })],
      );
    }
    const active = await client.query("SELECT count(*)::int AS count FROM control.admin_keys_current WHERE status='active'");
    if (active.rows[0].count > 2) throw new Error("admin key overlap exceeds two active keys");
    return identifiers;
  });
}

export async function verifyAdminKey(
  pool: Pool,
  tenantId: string,
  authorization: string | undefined,
): Promise<AdminIdentity | undefined> {
  const match = /^Bearer ([^\s]+)$/.exec(authorization ?? "");
  if (!match) return undefined;
  const candidate = match[1];
  const id = keyId(candidate);
  return withTenant(pool, tenantId, async (client) => {
    const result = await client.query<{ key_id: string; scrypt_salt: string; scrypt_digest: string }>(
      `SELECT key_id, scrypt_salt, scrypt_digest FROM control.admin_keys_current
       WHERE tenant_id=$1 AND key_id=$2 AND status='active'`,
      [tenantId, id],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    const actual = Buffer.from(verifier(candidate, Buffer.from(row.scrypt_salt, "hex")), "hex");
    const expected = Buffer.from(row.scrypt_digest, "hex");
    return timingSafeEqual(actual, expected) ? { keyId: row.key_id, tenantId } : undefined;
  });
}
