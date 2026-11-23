import dgram from "node:dgram";
import http from "node:http";
import net, { isIPv4 } from "node:net";
import tls from "node:tls";
import { isIpInLanSubnet, normalizeRemoteAddress, parseIpV4 } from "./network";
import type { DiscoveredTv, IpV4Address, LanInterface } from "./types";

const SSDP_HOST = "239.255.255.250";
const MDNS_HOST = "224.0.0.251";
const RENDERER = "urn:schemas-upnp-org:device:MediaRenderer:1";
const AV_TRANSPORT = "urn:schemas-upnp-org:service:AVTransport:1";
const CONNECTION_MANAGER = "urn:schemas-upnp-org:service:ConnectionManager:1";
const DIAL_SERVICE = "urn:dial-multiscreen-org:service:dial:1";
const SEARCH_TARGETS = [DIAL_SERVICE, RENDERER, AV_TRANSPORT, "roku:ecp"];
const AIRPLAY = "_airplay._tcp.local";
const GOOGLECAST = "_googlecast._tcp.local";
const IGNORED_TV_NAMES = /^cami\s*tv$/i;
const IGNORED_SERIALS = new Set(["X040008F6EVV", "28004000-0000-1000-8008-a429856d58ac"]);
const ROKU_LIMITED =
  "Roku ECP está em modo Limited. Na TV Roku, ative: Configurações > Sistema > Configurações avançadas do sistema > Controle por aplicativos móveis > Acesso à rede > Permissivo.";
const ROKU_FORMATS = [
  "video/mp4 (H.264/AAC Direct Play)",
  "application/vnd.apple.mpegurl (HLS Remux)",
  "video/x-matroska (H.264/AAC)",
  "text/vtt",
  "application/x-subrip"
];
const CAST_FORMATS = [
  "video/mp4 (H.264/HEVC Direct Play HTTP 206)",
  "video/mp4 (fMP4 Remux -c:v copy -c:a aac)",
  "application/vnd.apple.mpegurl (HLS VOD Remux)",
  "text/vtt (WebVTT Subtitles via CastV2 Track)"
];

export interface CommandResult {
  ok: boolean;
  status: number;
  detail: string;
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function decodeXmlEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,
    (entity: string, code: string) => {
      switch (code.toLowerCase()) {
        case "amp":
          return "&";
        case "lt":
          return "<";
        case "gt":
          return ">";
        case "quot":
          return '"';
        case "apos":
          return "'";
        default: {
          if (!code.startsWith("#")) return entity;
          const point =
            code[1]?.toLowerCase() === "x"
              ? Number.parseInt(code.slice(2), 16)
              : Number(code.slice(1));
          return Number.isInteger(point) &&
            point >= 0 &&
            point <= 0x10ffff &&
            (point < 0xd800 || point > 0xdfff)
            ? String.fromCodePoint(point)
            : entity;
        }
      }
    }
  );
}

export function xmlContents(xml: string, name: string): string {
  const match = new RegExp(
    `<(?:[\\w.-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}\\s*>`,
    "i"
  ).exec(xml);
  return (match?.[1] ?? "").trim();
}

export function xmlValue(xml: string, name: string): string {
  return decodeXmlEntities(xmlContents(xml, name));
}

export function isIgnoredNeighborDevice(name: string, idOrSerial?: string): boolean {
  if (IGNORED_TV_NAMES.test(name.trim())) return true;
  if (idOrSerial && IGNORED_SERIALS.has(idOrSerial.trim())) return true;
  return false;
}

function lanUrl(
  raw: string,
  lan: LanInterface,
  expectedHost?: string,
  allowLoopback = false
): URL | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" || url.username || url.password || !isIPv4(url.hostname))
      return null;
    if (!isIpInLanSubnet(url.hostname, lan, allowLoopback)) return null;
    if (expectedHost !== undefined && url.hostname !== expectedHost) return null;
    return url;
  } catch {
    return null;
  }
}

function request(
  url: URL,
  lan: LanInterface,
  method = "GET",
  headers: http.OutgoingHttpHeaders = {},
  body = ""
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const localAddress = url.hostname === "127.0.0.1" ? "127.0.0.1" : lan.address;
    const req = http.request(url, { method, headers, localAddress, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 512 * 1024) req.destroy(new Error("Resposta HTTP excedeu o limite."));
        else chunks.push(chunk);
      });
      res.on("error", reject);
      res.on("end", () =>
        resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") })
      );
    });
    const deadline = setTimeout(
      () => req.destroy(new Error("Tempo limite da solicitação HTTP.")),
      2200
    );
    req.on("close", () => clearTimeout(deadline));
    req.on("error", reject);
    req.end(body);
  });
}

function soap(url: URL, lan: LanInterface, service: string, action: string, args = "") {
  const body = `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="${service}">${args}</u:${action}></s:Body></s:Envelope>`;
  return request(
    url,
    lan,
    "POST",
    {
      "Content-Type": "text/xml; charset=utf-8",
      "Content-Length": Buffer.byteLength(body),
      SOAPAction: `"${service}#${action}"`
    },
    body
  );
}

function successful(status: number): boolean {
  return status >= 200 && status < 300;
}

function mdnsQuery(): Buffer {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(2, 4);
  const questions = [GOOGLECAST, AIRPLAY].map((name) => {
    const labels = name
      .split(".")
      .map((label) => Buffer.concat([Buffer.from([label.length]), Buffer.from(label)]));
    return Buffer.concat([...labels, Buffer.from([0, 0, 12, 0, 1])]);
  });
  return Buffer.concat([header, ...questions]);
}

function dnsName(packet: Buffer, start: number): { name: string; next: number } {
  const labels: string[] = [];
  let offset = start;
  let next: number | undefined;
  for (let steps = 0; steps < 128; steps++) {
    const size = packet.readUInt8(offset);
    if (size === 0) return { name: labels.join(".").toLowerCase(), next: next ?? offset + 1 };
    if ((size & 0xc0) === 0xc0) {
      next ??= offset + 2;
      offset = packet.readUInt16BE(offset) & 0x3fff;
    } else {
      if (size > 63 || offset + 1 + size >= packet.length) break;
      labels.push(packet.toString("utf8", offset + 1, offset + 1 + size));
      offset += size + 1;
    }
  }
  throw new Error("Nome DNS inválido.");
}

function parseMdnsServices(packet: Buffer): { airplay: boolean; googlecast: boolean } {
  let airplay = false;
  let googlecast = false;
  try {
    if (!(packet.readUInt16BE(2) & 0x8000)) return { airplay, googlecast };
    let offset = 12;
    const questionCount = packet.readUInt16BE(4);
    for (let i = 0; i < questionCount; i++) offset = dnsName(packet, offset).next + 4;
    const recordCount =
      packet.readUInt16BE(6) + packet.readUInt16BE(8) + packet.readUInt16BE(10);
    for (let i = 0; i < recordCount; i++) {
      const record = dnsName(packet, offset);
      const type = packet.readUInt16BE(record.next);
      const ttl = packet.readUInt32BE(record.next + 4);
      const size = packet.readUInt16BE(record.next + 8);
      offset = record.next + 10 + size;
      if (offset > packet.length) break;
      if (type === 12 && ttl > 0) {
        if (record.name === AIRPLAY) airplay = true;
        if (record.name === GOOGLECAST) googlecast = true;
      }
    }
  } catch {
    return { airplay, googlecast };
  }
  return { airplay, googlecast };
}

function collectMulticast(
  lan: LanInterface,
  group: string,
  port: number,
  messages: readonly Buffer[],
  timeoutMs: number,
  onMessage: (packet: Buffer, ip: IpV4Address) => void
): Promise<void> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket("udp4");
    const timer = setTimeout(() => socket.close(), timeoutMs);
    let retryTimer: NodeJS.Timeout | undefined;
    socket.on("close", () => {
      clearTimeout(timer);
      if (retryTimer) clearTimeout(retryTimer);
      resolve();
    });
    socket.on("error", () => socket.close());
    socket.on("message", (packet, info) => {
      if (!isIpInLanSubnet(info.address, lan, false)) return;
      const ip = parseIpV4(info.address);
      if (ip) onMessage(packet, ip);
    });
    socket.bind(0, lan.address, () => {
      try {
        socket.setMulticastInterface(lan.address);
        socket.setMulticastTTL(1);
        for (const message of messages) socket.send(message, port, group, () => {});
        if (timeoutMs >= 1000) {
          retryTimer = setTimeout(() => {
            try {
              for (const message of messages) socket.send(message, port, group, () => {});
            } catch {
              return;
            }
          }, 350);
        }
      } catch {
        socket.close();
      }
    });
  });
}

async function describeGoogleCast(ip: IpV4Address, lan: LanInterface): Promise<DiscoveredTv | null> {
  const [eurekaRes, descRes] = await Promise.all([
    request(new URL(`http://${ip}:8008/setup/eureka_info?options=detail`), lan).catch(() => null),
    request(new URL(`http://${ip}:8008/ssdp/device-desc.xml`), lan).catch(() => null)
  ]);

  let name = "";
  let id = "";
  let softwareVersion = "";
  let manufacturer = "Google Cast";
  let modelName = "Smart TV";

  if (eurekaRes && successful(eurekaRes.status)) {
    try {
      const info = JSON.parse(eurekaRes.body) as {
        name?: string;
        ssdp_udn?: string;
        cast_build_revision?: string;
        build_version?: string;
      };
      name = info.name ?? "";
      id = info.ssdp_udn ?? "";
      softwareVersion = info.cast_build_revision ?? info.build_version ?? "";
    } catch {
      name = "";
    }
  }

  if (descRes && successful(descRes.status)) {
    const xml = descRes.body;
    name = name || xmlValue(xml, "friendlyName");
    id = id || xmlValue(xml, "UDN").replace(/^uuid:/i, "");
    const rawMfg = xmlValue(xml, "manufacturer");
    const rawModel = xmlValue(xml, "modelName");
    if (rawModel) modelName = rawModel;
    if (rawMfg) manufacturer = rawMfg;
  }

  if (!name && !id) return null;
  if (isIgnoredNeighborDevice(name, id)) return null;

  return {
    id: id || `cast:${ip}`,
    protocol: "google-cast",
    name: name || `Google Cast TV (${ip})`,
    manufacturer,
    modelName,
    softwareVersion: softwareVersion || "CastV2",
    ip,
    port: 8009,
    locationUrl: `http://${ip}:8008/ssdp/device-desc.xml`,
    supportedFormats: CAST_FORMATS
  };
}

async function describeRoku(
  ip: IpV4Address,
  location: URL,
  lan: LanInterface,
  supportsAirPlay: boolean
): Promise<DiscoveredTv | null> {
  const response = await request(new URL(`http://${ip}:8060/query/device-info`), lan);
  if (!successful(response.status) || !/<device-info(?:\s|>)/i.test(response.body)) return null;
  const xml = response.body;
  const name =
    xmlValue(xml, "friendly-device-name") || xmlValue(xml, "user-device-name") || ip;
  const udn = xmlValue(xml, "udn");
  const serial = xmlValue(xml, "serial-number");
  if (isIgnoredNeighborDevice(name, udn) || isIgnoredNeighborDevice(name, serial)) {
    return null;
  }
  const mode = xmlValue(xml, "ecp-setting-mode").toLowerCase();
  return {
    id: udn || ip,
    protocol: "roku-ecp",
    name,
    manufacturer: xmlValue(xml, "vendor-name"),
    modelName: xmlValue(xml, "model-name"),
    modelNumber: xmlValue(xml, "model-number"),
    softwareVersion: xmlValue(xml, "software-version"),
    ip,
    port: 8060,
    locationUrl: location.href,
    ecpMode: mode === "limited" || mode === "permissive" ? mode : "unknown",
    supportsAirPlay,
    supportedFormats: ROKU_FORMATS
  };
}

async function describeRenderer(
  ip: IpV4Address,
  location: URL,
  lan: LanInterface
): Promise<DiscoveredTv | null> {
  const response = await request(location, lan);
  if (!successful(response.status) || /InternetGatewayDevice/i.test(response.body)) return null;
  const xml = response.body;
  if (!xml.includes(RENDERER)) return null;
  const name = xmlValue(xml, "friendlyName") || ip;
  const udn = xmlValue(xml, "UDN");
  if (isIgnoredNeighborDevice(name, udn)) return null;
  const advertisedBase = xmlValue(xml, "URLBase");
  const base = advertisedBase ? lanUrl(advertisedBase, lan, ip) : location;
  const services = Array.from(
    xml.matchAll(/<(?:[\w.-]+:)?service(?:\s[^>]*)?>[\s\S]*?<\/(?:[\w.-]+:)?service\s*>/gi),
    (match) => match[0]
  );
  function control(serviceType: string): URL | null {
    const service = services.find((entry) => xmlValue(entry, "serviceType") === serviceType);
    const path = service ? xmlValue(service, "controlURL") : "";
    if (!path || !base) return null;
    try {
      return lanUrl(new URL(path, base).href, lan, ip);
    } catch {
      return null;
    }
  }

  const avTransport = control(AV_TRANSPORT);
  const connectionManager = control(CONNECTION_MANAGER);
  let supportedProtocols: string[] = [];
  if (connectionManager) {
    const protocols = await soap(
      connectionManager,
      lan,
      CONNECTION_MANAGER,
      "GetProtocolInfo"
    ).catch(() => null);
    if (protocols && successful(protocols.status)) {
      supportedProtocols = xmlValue(protocols.body, "Sink")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    }
  }
  return {
    id: udn || ip,
    protocol: "dlna-dmr",
    name,
    manufacturer: xmlValue(xml, "manufacturer"),
    modelName: xmlValue(xml, "modelName"),
    ip,
    port: Number(location.port || 80),
    locationUrl: location.href,
    avTransportControlUrl: avTransport?.href ?? null,
    connectionManagerControlUrl: connectionManager?.href ?? null,
    supportedProtocols
  };
}

export async function discoverLanTvs(
  lan: LanInterface,
  timeoutMs = 2500
): Promise<DiscoveredTv[]> {
  const candidates = new Map<
    string,
    { ip: IpV4Address; location: URL; kind: "cast" | "roku" | "dlna" }
  >();
  const airPlay = new Set<IpV4Address>();
  const googleCastIps = new Set<IpV4Address>();
  const mx = Math.max(1, Math.min(3, Math.floor((timeoutMs - 800) / 1000)));
  const searches = SEARCH_TARGETS.map((target) =>
    Buffer.from(
      [
        "M-SEARCH * HTTP/1.1",
        `HOST: ${SSDP_HOST}:1900`,
        'MAN: "ssdp:discover"',
        `MX: ${mx}`,
        `ST: ${target}`,
        "",
        ""
      ].join("\r\n")
    )
  );

  await Promise.all([
    collectMulticast(lan, SSDP_HOST, 1900, searches, timeoutMs, (packet, ip) => {
      const message = packet.toString("utf8");
      if (!/^HTTP\/1\.[01] 200\b/i.test(message) || /InternetGatewayDevice/i.test(message))
        return;
      const target = /^ST:[ \t]*([^\r\n]+)/im.exec(message)?.[1]?.trim().toLowerCase();
      const rawLocation = /^LOCATION:[ \t]*([^\r\n]+)/im.exec(message)?.[1]?.trim();
      const location = rawLocation ? lanUrl(rawLocation, lan, ip) : null;
      if (!location || /gatedesc\.xml$/i.test(location.pathname)) return;
      if (location.port === "8008") {
        candidates.set(`cast:${ip}`, { ip, location, kind: "cast" });
        return;
      }
      const roku = target === "roku:ecp" || location.port === "8060";
      if (roku) {
        candidates.set(`roku:${ip}`, { ip, location, kind: "roku" });
        return;
      }
      if (target === RENDERER.toLowerCase() || target === AV_TRANSPORT.toLowerCase()) {
        candidates.set(location.href, { ip, location, kind: "dlna" });
      }
    }),
    collectMulticast(lan, MDNS_HOST, 5353, [mdnsQuery()], timeoutMs, (packet, ip) => {
      const parsed = parseMdnsServices(packet);
      if (parsed.airplay) airPlay.add(ip);
      if (parsed.googlecast) googleCastIps.add(ip);
    })
  ]);

  for (const ip of googleCastIps) {
    if (!candidates.has(`cast:${ip}`)) {
      candidates.set(`cast:${ip}`, {
        ip,
        location: new URL(`http://${ip}:8008/ssdp/device-desc.xml`),
        kind: "cast"
      });
    }
  }

  for (const ip of airPlay) {
    if (!candidates.has(`roku:${ip}`)) {
      candidates.set(`roku:${ip}`, {
        ip,
        location: new URL(`http://${ip}:8060/`),
        kind: "roku"
      });
    }
  }

  const devices = await Promise.all(
    Array.from(candidates.values(), async ({ ip, location, kind }) => {
      try {
        if (kind === "cast") return await describeGoogleCast(ip, lan);
        if (kind === "roku") return await describeRoku(ip, location, lan, airPlay.has(ip));
        return await describeRenderer(ip, location, lan);
      } catch {
        return null;
      }
    })
  );
  const unique = new Map<string, DiscoveredTv>();
  for (const device of devices) {
    if (device) unique.set(`${device.protocol}:${device.id}`, device);
  }
  return [...unique.values()];
}

function encodeVarint(val: number): Buffer {
  const bytes: number[] = [];
  let v = val >>> 0;
  while (v > 0x7f) {
    bytes.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  bytes.push(v);
  return Buffer.from(bytes);
}

function encodeStringField(fieldNo: number, str: string): Buffer {
  const buf = Buffer.from(str, "utf8");
  const tag = (fieldNo << 3) | 2;
  return Buffer.concat([encodeVarint(tag), encodeVarint(buf.length), buf]);
}

function encodeVarintField(fieldNo: number, val: number): Buffer {
  const tag = (fieldNo << 3) | 0;
  return Buffer.concat([encodeVarint(tag), encodeVarint(val)]);
}

function encodeCastMessage(
  sourceId: string,
  destinationId: string,
  namespace: string,
  payloadObj: Record<string, unknown>
): Buffer {
  const payloadStr = JSON.stringify(payloadObj);
  const body = Buffer.concat([
    encodeVarintField(1, 0),
    encodeStringField(2, sourceId),
    encodeStringField(3, destinationId),
    encodeStringField(4, namespace),
    encodeVarintField(5, 0),
    encodeStringField(6, payloadStr)
  ]);
  const lenPrefix = Buffer.alloc(4);
  lenPrefix.writeUInt32BE(body.length, 0);
  return Buffer.concat([lenPrefix, body]);
}

function decodeCastMessage(buf: Buffer): {
  sourceId?: string;
  destinationId?: string;
  namespace?: string;
  payloadUtf8?: string;
} {
  let offset = 0;
  const out: {
    sourceId?: string;
    destinationId?: string;
    namespace?: string;
    payloadUtf8?: string;
  } = {};
  while (offset < buf.length) {
    let shift = 0;
    let tag = 0;
    while (offset < buf.length) {
      const b = buf[offset++]!;
      tag |= (b & 0x7f) << shift;
      if (!(b & 0x80)) break;
      shift += 7;
    }
    const fieldNo = tag >>> 3;
    const wireType = tag & 7;
    if (wireType === 0) {
      while (offset < buf.length && buf[offset++]! & 0x80) {
        continue;
      }
    } else if (wireType === 2) {
      let len = 0;
      shift = 0;
      while (offset < buf.length) {
        const b = buf[offset++]!;
        len |= (b & 0x7f) << shift;
        if (!(b & 0x80)) break;
        shift += 7;
      }
      const slice = buf.subarray(offset, offset + len);
      offset += len;
      if (fieldNo === 2) out.sourceId = slice.toString("utf8");
      if (fieldNo === 3) out.destinationId = slice.toString("utf8");
      if (fieldNo === 4) out.namespace = slice.toString("utf8");
      if (fieldNo === 6) out.payloadUtf8 = slice.toString("utf8");
    } else {
      break;
    }
  }
  return out;
}

export async function castToGoogleCastTv(
  tvIp: string,
  streamUrl: string,
  title: string,
  mimeType: string,
  subtitleUrl: string | null,
  startSec: number,
  lan: LanInterface
): Promise<CommandResult> {
  const allowLoopback = (lan.address as string) === "127.0.0.1";
  if (!isIpInLanSubnet(tvIp, lan, allowLoopback)) {
    return { ok: false, status: 400, detail: "Endereço Google Cast fora da sub-rede LAN." };
  }
  const stream = lanUrl(streamUrl, lan, undefined, allowLoopback);
  const sub = subtitleUrl ? lanUrl(subtitleUrl, lan, undefined, allowLoopback) : null;
  if (!stream) {
    return { ok: false, status: 400, detail: "URL de stream inválida para Google Cast." };
  }

  return new Promise((resolve) => {
    const localAddress = tvIp === "127.0.0.1" ? "127.0.0.1" : lan.address;
    let settled = false;
    const finish = (res: CommandResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        sock.destroy();
      } catch {
        return;
      }
      resolve(res);
    };

    const tcpSocket = net.connect({
      host: normalizeRemoteAddress(tvIp),
      port: 8009,
      localAddress
    });
    tcpSocket.on("error", (err) => finish({ ok: false, status: 502, detail: err.message }));

    const sock = tls.connect(
      {
        socket: tcpSocket,
        rejectUnauthorized: false
      },
      () => {
        sock.write(
          encodeCastMessage("sender-0", "receiver-0", "urn:x-cast:com.google.cast.tp.connection", {
            type: "CONNECT"
          })
        );
        sock.write(
          encodeCastMessage("sender-0", "receiver-0", "urn:x-cast:com.google.cast.receiver", {
            type: "LAUNCH",
            appId: "CC1AD845",
            requestId: 1
          })
        );
      }
    );

    const timer = setTimeout(
      () => finish({ ok: false, status: 504, detail: "Timeout na sessão CastV2 (:8009)." }),
      7000
    );

    let acc = Buffer.alloc(0);
    let mediaLoadedSent = false;
    sock.on("data", (chunk: Buffer) => {
      acc = Buffer.concat([acc, chunk]);
      while (acc.length >= 4) {
        const msgLen = acc.readUInt32BE(0);
        if (acc.length < 4 + msgLen) break;
        const msgBuf = acc.subarray(4, 4 + msgLen);
        acc = acc.subarray(4 + msgLen);
        const msg = decodeCastMessage(msgBuf);
        if (msg.namespace === "urn:x-cast:com.google.cast.tp.heartbeat") {
          sock.write(
            encodeCastMessage(
              "sender-0",
              "receiver-0",
              "urn:x-cast:com.google.cast.tp.heartbeat",
              { type: "PONG" }
            )
          );
          continue;
        }
        if (!msg.payloadUtf8) continue;
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(msg.payloadUtf8) as Record<string, unknown>;
        } catch {
          continue;
        }

        if (payload.type === "RECEIVER_STATUS" && !mediaLoadedSent) {
          const status = payload.status as
            | { applications?: Array<{ appId?: string; transportId?: string }> }
            | undefined;
          const app = status?.applications?.find((a) => a.appId === "CC1AD845");
          if (app?.transportId) {
            mediaLoadedSent = true;
            const transportId = app.transportId;
            sock.write(
              encodeCastMessage(
                "sender-0",
                transportId,
                "urn:x-cast:com.google.cast.tp.connection",
                { type: "CONNECT" }
              )
            );
            const tracks = sub
              ? [
                  {
                    trackId: 1,
                    type: "TEXT",
                    trackContentId: sub.href,
                    trackContentType: "text/vtt",
                    name: "Legenda",
                    language: "pt-BR",
                    subtype: "SUBTITLES"
                  }
                ]
              : [];
            sock.write(
              encodeCastMessage("sender-0", transportId, "urn:x-cast:com.google.cast.media", {
                type: "LOAD",
                requestId: 2,
                autoplay: true,
                currentTime: Math.max(0, startSec),
                activeTrackIds: sub ? [1] : [],
                media: {
                  contentId: stream.href,
                  contentType: mimeType,
                  streamType: "BUFFERED",
                  metadata: {
                    type: 0,
                    metadataType: 0,
                    title
                  },
                  tracks
                }
              })
            );
          }
        } else if (
          payload.type === "MEDIA_STATUS" ||
          payload.type === "LOAD_FAILED" ||
          payload.type === "LOAD_CANCELLED"
        ) {
          if (payload.type === "MEDIA_STATUS") {
            finish({ ok: true, status: 200, detail: "Stream carregado no Google Cast." });
          } else {
            finish({
              ok: false,
              status: 502,
              detail: `Google Cast recusou mídia: ${String(payload.type)}`
            });
          }
        }
      }
    });

    sock.on("error", (err) => finish({ ok: false, status: 502, detail: err.message }));
  });
}

export async function controlGoogleCastTv(
  tvIp: string,
  action: "PLAY" | "PAUSE" | "STOP" | "SEEK" | "SUBTITLE_ON" | "SUBTITLE_OFF" | "VOLUME",
  value: number | undefined,
  lan: LanInterface
): Promise<CommandResult> {
  const allowLoopback = (lan.address as string) === "127.0.0.1";
  if (!isIpInLanSubnet(tvIp, lan, allowLoopback)) {
    return { ok: false, status: 400, detail: "Endereço Google Cast fora da sub-rede LAN." };
  }

  return new Promise((resolve) => {
    const localAddress = tvIp === "127.0.0.1" ? "127.0.0.1" : lan.address;
    let settled = false;
    const finish = (res: CommandResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        sock.destroy();
      } catch {
        return;
      }
      resolve(res);
    };

    const tcpSocket = net.connect({
      host: normalizeRemoteAddress(tvIp),
      port: 8009,
      localAddress
    });
    tcpSocket.on("error", (err) => finish({ ok: false, status: 502, detail: err.message }));

    const sock = tls.connect({ socket: tcpSocket, rejectUnauthorized: false }, () => {
      sock.write(
        encodeCastMessage("sender-0", "receiver-0", "urn:x-cast:com.google.cast.tp.connection", {
          type: "CONNECT"
        })
      );
      if (action === "VOLUME") {
        const level = Math.max(0, Math.min(1, Number(value ?? 0.3)));
        sock.write(
          encodeCastMessage("sender-0", "receiver-0", "urn:x-cast:com.google.cast.receiver", {
            type: "SET_VOLUME",
            volume: { level, muted: false },
            requestId: 10
          })
        );
      } else {
        sock.write(
          encodeCastMessage("sender-0", "receiver-0", "urn:x-cast:com.google.cast.receiver", {
            type: "GET_STATUS",
            requestId: 10
          })
        );
      }
    });

    const timer = setTimeout(
      () => finish({ ok: false, status: 504, detail: "Timeout no comando CastV2 (:8009)." }),
      5000
    );

    let acc = Buffer.alloc(0);
    let activeTransportId: string | null = null;
    let commandSent = false;

    sock.on("data", (chunk: Buffer) => {
      acc = Buffer.concat([acc, chunk]);
      while (acc.length >= 4) {
        const msgLen = acc.readUInt32BE(0);
        if (acc.length < 4 + msgLen) break;
        const msgBuf = acc.subarray(4, 4 + msgLen);
        acc = acc.subarray(4 + msgLen);
        const msg = decodeCastMessage(msgBuf);
        if (msg.namespace === "urn:x-cast:com.google.cast.tp.heartbeat") {
          sock.write(
            encodeCastMessage(
              "sender-0",
              "receiver-0",
              "urn:x-cast:com.google.cast.tp.heartbeat",
              { type: "PONG" }
            )
          );
          continue;
        }
        if (!msg.payloadUtf8) continue;
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(msg.payloadUtf8) as Record<string, unknown>;
        } catch {
          continue;
        }

        if (action === "VOLUME" && payload.type === "RECEIVER_STATUS") {
          finish({ ok: true, status: 200, detail: "Volume atualizado na TV." });
          return;
        }

        if (payload.type === "RECEIVER_STATUS" && !activeTransportId) {
          const status = payload.status as
            | { applications?: Array<{ appId?: string; transportId?: string }> }
            | undefined;
          const app = status?.applications?.[0];
          if (!app?.transportId) {
            finish({ ok: false, status: 404, detail: "Nenhuma sessão de mídia ativa na TV." });
            return;
          }
          activeTransportId = app.transportId;
          sock.write(
            encodeCastMessage(
              "sender-0",
              activeTransportId,
              "urn:x-cast:com.google.cast.tp.connection",
              { type: "CONNECT" }
            )
          );
          sock.write(
            encodeCastMessage("sender-0", activeTransportId, "urn:x-cast:com.google.cast.media", {
              type: "GET_STATUS",
              requestId: 11
            })
          );
        } else if (payload.type === "MEDIA_STATUS" && activeTransportId) {
          if (commandSent) {
            finish({ ok: true, status: 200, detail: `Comando ${action} aplicado na TV.` });
            return;
          }
          const statuses = payload.status as Array<{ mediaSessionId?: number }> | undefined;
          const mediaSessionId = statuses?.[0]?.mediaSessionId;
          if (mediaSessionId === undefined) {
            finish({ ok: false, status: 404, detail: "Nenhum vídeo em reprodução na TV." });
            return;
          }
          commandSent = true;
          let mediaCmd: Record<string, unknown>;
          switch (action) {
            case "PLAY":
              mediaCmd = { type: "PLAY", mediaSessionId, requestId: 12 };
              break;
            case "PAUSE":
              mediaCmd = { type: "PAUSE", mediaSessionId, requestId: 12 };
              break;
            case "STOP":
              mediaCmd = { type: "STOP", mediaSessionId, requestId: 12 };
              break;
            case "SEEK":
              mediaCmd = {
                type: "SEEK",
                mediaSessionId,
                currentTime: Math.max(0, Number(value ?? 0)),
                requestId: 12
              };
              break;
            case "SUBTITLE_ON":
              mediaCmd = {
                type: "EDIT_TRACKS_INFO",
                mediaSessionId,
                activeTrackIds: [1],
                requestId: 12
              };
              break;
            case "SUBTITLE_OFF":
              mediaCmd = {
                type: "EDIT_TRACKS_INFO",
                mediaSessionId,
                activeTrackIds: [],
                requestId: 12
              };
              break;
            default:
              mediaCmd = { type: "GET_STATUS", requestId: 12 };
          }
          sock.write(
            encodeCastMessage(
              "sender-0",
              activeTransportId,
              "urn:x-cast:com.google.cast.media",
              mediaCmd
            )
          );
        }
      }
    });

    sock.on("error", (err) => finish({ ok: false, status: 502, detail: err.message }));
  });
}

async function rokuCommand(tvIp: string, path: string, lan: LanInterface): Promise<CommandResult> {
  const allowLoopback = (lan.address as string) === "127.0.0.1";
  if (!isIpInLanSubnet(tvIp, lan, allowLoopback))
    return { ok: false, status: 400, detail: "Endereço Roku fora da rede local." };
  const ip = normalizeRemoteAddress(tvIp);
  const url = lanUrl(`http://${ip}:8060${path}`, lan, undefined, allowLoopback);
  if (!url || url.pathname !== path.split("?")[0])
    return { ok: false, status: 400, detail: "Endereço ou comando Roku inválido." };
  try {
    const response = await request(url, lan, "POST", { "Content-Length": 0 });
    if (response.status === 403) return { ok: false, status: 403, detail: ROKU_LIMITED };
    return { ok: successful(response.status), status: response.status, detail: response.body };
  } catch (error) {
    return { ok: false, status: 502, detail: String(error) };
  }
}

export function sendRokuKeypress(
  tvIp: string,
  key: string,
  lan: LanInterface
): Promise<CommandResult> {
  return rokuCommand(tvIp, `/keypress/${encodeURIComponent(key)}`, lan);
}

export function launchRokuApp(
  tvIp: string,
  appId: string,
  params: Record<string, string>,
  lan: LanInterface
): Promise<CommandResult> {
  const query = new URLSearchParams(params).toString();
  return rokuCommand(
    tvIp,
    `/launch/${encodeURIComponent(appId || "2213")}${query ? `?${query}` : ""}`,
    lan
  );
}

export async function pushToDlnaRenderer(
  controlUrl: string,
  streamUrl: string,
  title: string,
  mimeType: string,
  subtitleUrl: string | null,
  lan: LanInterface
): Promise<CommandResult> {
  const control = lanUrl(controlUrl, lan);
  const stream = lanUrl(streamUrl, lan);
  const subtitle = subtitleUrl === null ? null : lanUrl(subtitleUrl, lan);
  if (!control || !stream || (subtitleUrl !== null && !subtitle)) {
    return { ok: false, status: 400, detail: "URL DLNA fora da rede local ou inválida." };
  }

  const caption = subtitle
    ? `<sec:CaptionInfoEx sec:type="srt">${escapeXml(subtitle.href)}</sec:CaptionInfoEx><pv:subtitleFileUri>${escapeXml(subtitle.href)}</pv:subtitleFileUri>`
    : "";
  const metadata = `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:sec="http://www.sec.co.kr/" xmlns:pv="http://www.pv.com/pvns/"><item id="1" parentID="0" restricted="1"><dc:title>${escapeXml(title)}</dc:title><upnp:class>object.item.videoItem</upnp:class><res protocolInfo="http-get:*:${escapeXml(mimeType)}:*">${escapeXml(stream.href)}</res>${caption}</item></DIDL-Lite>`;
  try {
    const set = await soap(
      control,
      lan,
      AV_TRANSPORT,
      "SetAVTransportURI",
      `<InstanceID>0</InstanceID><CurrentURI>${escapeXml(stream.href)}</CurrentURI><CurrentURIMetaData>${escapeXml(metadata)}</CurrentURIMetaData>`
    );
    if (!successful(set.status) || xmlValue(set.body, "faultcode")) {
      return { ok: false, status: set.status, detail: set.body };
    }
    const play = await soap(
      control,
      lan,
      AV_TRANSPORT,
      "Play",
      "<InstanceID>0</InstanceID><Speed>1</Speed>"
    );
    return {
      ok: successful(play.status) && !xmlValue(play.body, "faultcode"),
      status: play.status,
      detail: play.body
    };
  } catch (error) {
    return { ok: false, status: 502, detail: String(error) };
  }
}
