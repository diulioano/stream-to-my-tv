import os from "node:os";
import { IpV4Address, LanInterface } from "./types";

const VIRTUAL_ADAPTER_PATTERN =
  /wsl|hyper-v|vethernet|docker|vbox|vmware|virtual|tailscale|zerotier|wireguard|tun|tap|loopback|bluetooth|npcap|hamachi/i;

export function ipv4ToInt(ip: string): number | null {
  const parts = ip.trim().split(".");
  if (parts.length !== 4) return null;
  let acc = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    const n = Number(part);
    if (n < 0 || n > 255) return null;
    acc = ((acc << 8) | n) >>> 0;
  }
  return acc >>> 0;
}

export function parseIpV4(raw: string): IpV4Address | null {
  const normalized = normalizeRemoteAddress(raw);
  return ipv4ToInt(normalized) !== null ? (normalized as IpV4Address) : null;
}

export function normalizeRemoteAddress(raw: string | undefined): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (trimmed.startsWith("::ffff:")) {
    return trimmed.slice(7);
  }
  return trimmed;
}

export function isRfc1918PrivateIp(ip: string): boolean {
  const n = ipv4ToInt(normalizeRemoteAddress(ip));
  if (n === null) return false;
  const first = (n >>> 24) & 0xff;
  const second = (n >>> 16) & 0xff;
  if (first === 10) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 192 && second === 168) return true;
  return false;
}

export function isLinkLocalApipa(ip: string): boolean {
  const n = ipv4ToInt(normalizeRemoteAddress(ip));
  if (n === null) return false;
  return ((n >>> 24) & 0xff) === 169 && ((n >>> 16) & 0xff) === 254;
}

export function isVirtualAdapterName(name: string): boolean {
  return VIRTUAL_ADAPTER_PATTERN.test(name);
}

export function prefixLengthFromNetmask(netmask: string): number {
  const maskInt = ipv4ToInt(netmask);
  if (maskInt === null) return 24;
  let bits = 0;
  let m = maskInt;
  while (m & 0x80000000) {
    bits++;
    m = (m << 1) >>> 0;
  }
  return bits;
}

export function buildLanInterface(
  name: string,
  addressStr: string,
  netmask: string,
  mac = "00:00:00:00:00:00"
): LanInterface {
  const address = parseIpV4(addressStr);
  const ipInt = ipv4ToInt(addressStr);
  const maskInt = ipv4ToInt(netmask);
  if (!address || ipInt === null || maskInt === null) {
    throw new Error(`Invalid IPv4 interface configuration: ${addressStr}/${netmask}`);
  }
  const prefixLength = prefixLengthFromNetmask(netmask);
  const subnetBaseInt = (ipInt & maskInt) >>> 0;
  return {
    name,
    address,
    netmask,
    cidr: `${address}/${prefixLength}`,
    mac,
    prefixLength,
    subnetBaseInt,
    subnetMaskInt: maskInt >>> 0
  };
}

export function detectLanInterfaces(
  interfacesMap: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces()
): LanInterface[] {
  const candidates: LanInterface[] = [];
  for (const [name, entries] of Object.entries(interfacesMap)) {
    if (!entries || isVirtualAdapterName(name)) continue;
    for (const entry of entries) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      if (isLinkLocalApipa(entry.address)) continue;
      if (!isRfc1918PrivateIp(entry.address)) continue;
      candidates.push(buildLanInterface(name, entry.address, entry.netmask, entry.mac));
    }
  }
  candidates.sort((a, b) => {
    const aWifiEth = /wi-?fi|wlan|ethernet|eth/i.test(a.name) ? 0 : 1;
    const bWifiEth = /wi-?fi|wlan|ethernet|eth/i.test(b.name) ? 0 : 1;
    if (aWifiEth !== bWifiEth) return aWifiEth - bWifiEth;
    const a192 = a.address.startsWith("192.168.") ? 0 : 1;
    const b192 = b.address.startsWith("192.168.") ? 0 : 1;
    return a192 - b192;
  });
  return candidates;
}

export function selectPrimaryLanInterface(
  explicitIp?: string,
  interfacesMap: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces()
): LanInterface {
  const all = detectLanInterfaces(interfacesMap);
  if (explicitIp) {
    const found = all.find((i) => i.address === explicitIp);
    if (found) return found;
    if (isRfc1918PrivateIp(explicitIp)) {
      return buildLanInterface("CustomLAN", explicitIp, "255.255.255.0");
    }
    throw new Error(`Explicit IP ${explicitIp} is not a valid RFC 1918 private LAN address`);
  }
  const primary = all[0];
  if (!primary) {
    throw new Error("No physical RFC 1918 LAN interface found");
  }
  return primary;
}

export function isIpInLanSubnet(
  remoteAddress: string | undefined,
  lan: LanInterface,
  allowLoopback = false
): boolean {
  const normalized = normalizeRemoteAddress(remoteAddress);
  if (!normalized) return false;
  if (allowLoopback && (normalized === "127.0.0.1" || normalized === "::1")) {
    return true;
  }
  if (!isRfc1918PrivateIp(normalized)) return false;
  const ipInt = ipv4ToInt(normalized);
  if (ipInt === null) return false;
  return ((ipInt & lan.subnetMaskInt) >>> 0) === lan.subnetBaseInt;
}
