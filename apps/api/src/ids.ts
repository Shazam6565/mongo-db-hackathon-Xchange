import { createHash } from "node:crypto";

// Deterministic RFC 4122-shaped UUID (version 5 layout, SHA-256 truncated) from stable parts.
// Used for retry-safe operation IDs: the same parts always produce the same ID.
export function stableUuid(...parts: string[]): string {
  const bytes = createHash("sha256").update(parts.join("\u0000")).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
