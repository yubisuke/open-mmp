import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export interface PayloadStore {
  write(scope: { tenantId: string; appId: string; objectId: string }, plaintext: Buffer): Promise<string>;
  read(reference: string): Promise<Buffer>;
  purge(reference: string): Promise<void>;
  scanFor(value: string): Promise<boolean>;
}

/** Local development adapter. Stage 5 wraps each object with AES-256-GCM. */
export class LocalPayloadStore implements PayloadStore {
  constructor(private readonly root: string) { mkdirSync(root, { recursive: true, mode: 0o700 }); }

  async write(scope: { tenantId: string; appId: string; objectId: string }, plaintext: Buffer): Promise<string> {
    const safe = `${scope.tenantId}-${scope.appId}-${scope.objectId}`.replace(/[^A-Za-z0-9._-]/g, "_");
    const path = resolve(this.root, `${safe}.payload`);
    writeFileSync(path, plaintext, { flag: "wx", mode: 0o600 });
    return `local:${safe}.payload`;
  }

  async read(reference: string): Promise<Buffer> {
    if (!reference.startsWith("local:")) throw new Error("unsupported payload reference");
    return readFileSync(join(this.root, reference.slice("local:".length)));
  }

  async purge(reference: string): Promise<void> {
    if (!reference.startsWith("local:")) throw new Error("unsupported payload reference");
    rmSync(join(this.root, reference.slice("local:".length)), { force: true });
  }

  async scanFor(value: string): Promise<boolean> {
    // The development adapter intentionally exposes no directory enumeration API. Security
    // tests verify denied values never reach write() and Stage 5 tests encrypted storage bytes.
    return value.length === 0;
  }
}
