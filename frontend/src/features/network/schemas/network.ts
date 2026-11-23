import { z } from "zod";
import { sessionSchema } from "../../player/schemas/session";

export const lanInterfaceSchema = z.object({
  name: z.string(),
  address: z.string(),
  netmask: z.string(),
  cidr: z.string(),
  mac: z.string(),
  prefixLength: z.number().int()
});

export type LanInterface = z.infer<typeof lanInterfaceSchema>;

export const networkResponseSchema = z.object({
  lan: lanInterfaceSchema,
  bindHost: z.string(),
  port: z.number().int(),
  baseUrl: z.string(),
  panelUrl: z.string(),
  qrSvgUrl: z.string(),
  suggestedDownloadsDir: z.string().nullable(),
  lastScannedPaths: z.array(z.string())
});

export type NetworkInfo = z.infer<typeof networkResponseSchema>;

export const serverStatusSchema = z.object({
  ok: z.literal(true),
  pid: z.number().int(),
  port: z.number().int(),
  baseUrl: z.string(),
  lan: lanInterfaceSchema,
  allowLoopback: z.boolean(),
  activeMediaProcesses: z.number().int(),
  catalogCount: z.number().int(),
  session: sessionSchema
});

export type ServerStatus = z.infer<typeof serverStatusSchema>;

export type QrEcc = "M" | "Q";

const RFC1918_BLOCKS: readonly (readonly [base: number, prefix: number])[] = [
  [ipv4ToInt("10.0.0.0"), 8],
  [ipv4ToInt("172.16.0.0"), 12],
  [ipv4ToInt("192.168.0.0"), 16]
];

function ipv4ToInt(address: string): number {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return Number.NaN;
  return octets.reduce((acc, octet) => acc * 256 + octet, 0);
}

/** True when the whole CIDR block lies inside 10/8, 172.16/12 or 192.168/16. */
export function isRfc1918Cidr(cidr: string): boolean {
  const [address = "", prefixText = ""] = cidr.split("/");
  const value = ipv4ToInt(address);
  const prefix = Number(prefixText);
  if (Number.isNaN(value) || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
  return RFC1918_BLOCKS.some(([base, blockPrefix]) => {
    const size = 2 ** (32 - blockPrefix);
    return prefix >= blockPrefix && value >= base && value < base + size;
  });
}
