import dgram from "node:dgram";
import { escapeXml, xmlContents, xmlValue } from "./discovery";
import { isIpInLanSubnet } from "./network";
import type { ActiveSessionState, LanInterface, MediaItem } from "./types";

export const SERVER_UDN = "uuid:stream-to-my-tv-lan-mediaserver-0001";

const DEVICE_TYPE = "urn:schemas-upnp-org:device:MediaServer:1";
const CONTENT_DIRECTORY = "urn:schemas-upnp-org:service:ContentDirectory:1";
const CONNECTION_MANAGER = "urn:schemas-upnp-org:service:ConnectionManager:1";
const SSDP_HOST = "239.255.255.250";
const SSDP_PORT = 1900;
const SERVER = "Node.js UPnP/1.0 StreamToMyTV/1.0";
const MAX_AGE = 1800;
const XML_HEADER = '<?xml version="1.0" encoding="utf-8"?>';
const MP4 = "http-get:*:video/mp4:*";
const HLS = "http-get:*:application/vnd.apple.mpegurl:*";
const SOURCE_PROTOCOLS = [MP4, HLS, "http-get:*:text/srt:*", "http-get:*:text/vtt:*"].join(",");
const SSDP_TARGETS = ["upnp:rootdevice", DEVICE_TYPE, CONTENT_DIRECTORY, CONNECTION_MANAGER, SERVER_UDN];
const DIDL_NAMESPACES = 'xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:sec="http://www.sec.co.kr/"';

const services = [
  { type: CONTENT_DIRECTORY, name: "ContentDirectory", path: "content-directory" },
  { type: CONNECTION_MANAGER, name: "ConnectionManager", path: "connection-manager" }
];

export function buildDlnaDeviceXml(baseUrl: string, friendlyName = "Stream to My TV"): string {
  const serviceList = services.map(({ type, name, path }) =>
    `<service><serviceType>${type}</serviceType><serviceId>urn:upnp-org:serviceId:${name}</serviceId><SCPDURL>/dlna/${path}.xml</SCPDURL><controlURL>/dlna/${path}/control</controlURL><eventSubURL>/dlna/${path}/event</eventSubURL></service>`
  ).join("");
  return `${XML_HEADER}<root xmlns="urn:schemas-upnp-org:device-1-0"><specVersion><major>1</major><minor>0</minor></specVersion><URLBase>${escapeXml(baseUrl.replace(/\/$/, "") + "/")}</URLBase><device><deviceType>${DEVICE_TYPE}</deviceType><friendlyName>${escapeXml(friendlyName)}</friendlyName><manufacturer>Stream to My TV</manufacturer><modelName>LAN MediaServer</modelName><modelNumber>1</modelNumber><UDN>${SERVER_UDN}</UDN><serviceList>${serviceList}</serviceList></device></root>`;
}

type Argument = readonly [name: string, direction: "in" | "out", stateVariable: string];
type StateVariable = readonly [dataType: string, allowedValues?: readonly string[]];

function scpd(actions: Record<string, readonly Argument[]>, variables: Record<string, StateVariable>): string {
  const actionList = Object.entries(actions).map(([action, args]) => {
    const argumentList = args.map(([name, direction, variable]) =>
      `<argument><name>${name}</name><direction>${direction}</direction><relatedStateVariable>${variable}</relatedStateVariable></argument>`
    ).join("");
    return `<action><name>${action}</name><argumentList>${argumentList}</argumentList></action>`;
  }).join("");
  const stateTable = Object.entries(variables).map(([name, [type, values]]) =>
    `<stateVariable sendEvents="no"><name>${name}</name><dataType>${type}</dataType>${values ? `<allowedValueList>${values.map((value) => `<allowedValue>${value}</allowedValue>`).join("")}</allowedValueList>` : ""}</stateVariable>`
  ).join("");
  return `${XML_HEADER}<scpd xmlns="urn:schemas-upnp-org:service-1-0"><specVersion><major>1</major><minor>0</minor></specVersion><actionList>${actionList}</actionList><serviceStateTable>${stateTable}</serviceStateTable></scpd>`;
}

export function buildContentDirectoryScpdXml(): string {
  return scpd({
    GetSearchCapabilities: [["SearchCaps", "out", "SearchCapabilities"]],
    GetSortCapabilities: [["SortCaps", "out", "SortCapabilities"]],
    GetSystemUpdateID: [["Id", "out", "SystemUpdateID"]],
    Browse: [
      ["ObjectID", "in", "A_ARG_TYPE_ObjectID"], ["BrowseFlag", "in", "A_ARG_TYPE_BrowseFlag"],
      ["Filter", "in", "A_ARG_TYPE_Filter"], ["StartingIndex", "in", "A_ARG_TYPE_Index"],
      ["RequestedCount", "in", "A_ARG_TYPE_Count"], ["SortCriteria", "in", "A_ARG_TYPE_SortCriteria"],
      ["Result", "out", "A_ARG_TYPE_Result"], ["NumberReturned", "out", "A_ARG_TYPE_Count"],
      ["TotalMatches", "out", "A_ARG_TYPE_Count"], ["UpdateID", "out", "A_ARG_TYPE_UpdateID"]
    ]
  }, {
    SearchCapabilities: ["string"], SortCapabilities: ["string"], SystemUpdateID: ["ui4"],
    A_ARG_TYPE_ObjectID: ["string"], A_ARG_TYPE_BrowseFlag: ["string", ["BrowseMetadata", "BrowseDirectChildren"]],
    A_ARG_TYPE_Filter: ["string"], A_ARG_TYPE_Index: ["ui4"], A_ARG_TYPE_Count: ["ui4"],
    A_ARG_TYPE_SortCriteria: ["string"], A_ARG_TYPE_Result: ["string"], A_ARG_TYPE_UpdateID: ["ui4"]
  });
}

export function buildConnectionManagerScpdXml(): string {
  return scpd({
    GetProtocolInfo: [["Source", "out", "SourceProtocolInfo"], ["Sink", "out", "SinkProtocolInfo"]],
    GetCurrentConnectionIDs: [["ConnectionIDs", "out", "CurrentConnectionIDs"]],
    GetCurrentConnectionInfo: [
      ["ConnectionID", "in", "A_ARG_TYPE_ConnectionID"], ["RcsID", "out", "A_ARG_TYPE_RcsID"],
      ["AVTransportID", "out", "A_ARG_TYPE_AVTransportID"], ["ProtocolInfo", "out", "A_ARG_TYPE_ProtocolInfo"],
      ["PeerConnectionManager", "out", "A_ARG_TYPE_ConnectionManager"],
      ["PeerConnectionID", "out", "A_ARG_TYPE_ConnectionID"], ["Direction", "out", "A_ARG_TYPE_Direction"],
      ["Status", "out", "A_ARG_TYPE_ConnectionStatus"]
    ]
  }, {
    SourceProtocolInfo: ["string"], SinkProtocolInfo: ["string"], CurrentConnectionIDs: ["string"],
    A_ARG_TYPE_ConnectionID: ["i4"], A_ARG_TYPE_RcsID: ["i4"], A_ARG_TYPE_AVTransportID: ["i4"],
    A_ARG_TYPE_ProtocolInfo: ["string"], A_ARG_TYPE_ConnectionManager: ["string"],
    A_ARG_TYPE_Direction: ["string", ["Input", "Output"]],
    A_ARG_TYPE_ConnectionStatus: ["string", ["OK", "ContentFormatMismatch", "InsufficientBandwidth", "UnreliableChannel", "Unknown"]]
  });
}

interface SoapResponse {
  status: number;
  xml: string;
}

function envelope(payload: string): string {
  return `${XML_HEADER}<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body>${payload}</s:Body></s:Envelope>`;
}

function reply(service: string, action: string, payload: string): SoapResponse {
  return { status: 200, xml: envelope(`<u:${action}Response xmlns:u="${service}">${payload}</u:${action}Response>`) };
}

function fault(code: number, description: string): SoapResponse {
  return {
    status: 500,
    xml: envelope(`<s:Fault><faultcode>s:Client</faultcode><faultstring>UPnPError</faultstring><detail><UPnPError xmlns="urn:schemas-upnp-org:control-1-0"><errorCode>${code}</errorCode><errorDescription>${description}</errorDescription></UPnPError></detail></s:Fault>`)
  };
}

function bodyAction(body: string): string | undefined {
  return /^(?:\s|<!--[\s\S]*?-->)*<(?:[\w.-]+:)?([A-Za-z]\w*)(?=[\s/>])/.exec(body)?.[1];
}

export function handleConnectionManagerSoap(soapBody: string): SoapResponse {
  const body = xmlContents(soapBody, "Body");
  const action = bodyAction(body);
  switch (action) {
    case "GetProtocolInfo":
      return reply(CONNECTION_MANAGER, action, `<Source>${SOURCE_PROTOCOLS}</Source><Sink></Sink>`);
    case "GetCurrentConnectionIDs":
      return reply(CONNECTION_MANAGER, action, "<ConnectionIDs>0</ConnectionIDs>");
    case "GetCurrentConnectionInfo":
      if (xmlValue(body, "ConnectionID") !== "0") return fault(706, "Invalid Connection Reference");
      return reply(CONNECTION_MANAGER, action, "<RcsID>-1</RcsID><AVTransportID>-1</AVTransportID><ProtocolInfo></ProtocolInfo><PeerConnectionManager></PeerConnectionManager><PeerConnectionID>-1</PeerConnectionID><Direction>Output</Direction><Status>OK</Status>");
    default:
      return fault(401, "Invalid Action");
  }
}

interface CatalogEntry {
  id: string;
  xml: string;
}

function duration(seconds: number): string {
  const whole = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return [Math.floor(whole / 3600), Math.floor(whole / 60) % 60, whole % 60]
    .map((unit) => String(unit).padStart(2, "0")).join(":");
}

function catalogEntry(
  media: MediaItem, id: string, label: string, baseUrl: string,
  audioStreamIndex: number | null, direct: boolean, subtitleIds: readonly string[]
): CatalogEntry {
  const mediaUrl = `${baseUrl}/media/${encodeURIComponent(media.id)}`;
  const length = duration(media.durationSec);
  const audio = audioStreamIndex === null ? "" : `?audio=${audioStreamIndex}`;
  const subtitles = subtitleIds.map((subtitleId) => {
    const url = escapeXml(`${baseUrl}/subtitles/${encodeURIComponent(media.id)}/${encodeURIComponent(subtitleId)}`);
    return `<sec:CaptionInfoEx sec:type="srt">${url}.srt</sec:CaptionInfoEx><res protocolInfo="http-get:*:text/srt:*">${url}.vtt</res>`;
  }).join("");
  const resources = direct
    ? `<res protocolInfo="${MP4}" size="${media.fileSize}" duration="${length}">${escapeXml(mediaUrl)}/direct.mp4</res>`
    : `<res protocolInfo="${HLS}" duration="${length}">${escapeXml(`${mediaUrl}/hls/master.m3u8${audio}`)}</res><res protocolInfo="${MP4}" duration="${length}">${escapeXml(`${mediaUrl}/remux.mp4${audio}`)}</res>`;
  return {
    id,
    xml: `<item id="${escapeXml(id)}" parentID="0" restricted="1"><dc:title>${escapeXml(`${label} ${media.title}`)}</dc:title><upnp:class>object.item.videoItem</upnp:class>${resources}${subtitles}</item>`
  };
}

function buildEntries(catalog: readonly MediaItem[], session: ActiveSessionState, base: string): CatalogEntry[] {
  const baseUrl = base.replace(/\/$/, "");
  const entries: CatalogEntry[] = [];
  const selected = catalog.find((media) => media.id === session.mediaId);
  if (selected) {
    const audio = selected.audioTracks.find((track) => track.streamIndex === session.audioStreamIndex);
    const subtitle = selected.subtitleTracks.find((track) => track.id === session.subtitleId);
    const direct = selected.canDirectPlayDefault && (!audio || audio.streamIndex === selected.audioTracks[0]?.streamIndex);
    entries.push(catalogEntry(selected, `selected:${selected.id}`, "[Selecionado no Painel]", baseUrl, audio?.streamIndex ?? null, direct, subtitle ? [subtitle.id] : []));
  }

  for (const media of catalog) {
    const subtitles = media.subtitleTracks.map((track) => track.id);
    if (media.canDirectPlayDefault) {
      entries.push(catalogEntry(media, `direct:${media.id}`, "[Direct Play]", baseUrl, null, true, subtitles));
    }
    for (const track of media.audioTracks) {
      const label = `[Remux AAC - Faixa ${track.language.toUpperCase()} ${track.title || track.codec.toUpperCase()}]`;
      entries.push(catalogEntry(media, `remux:${media.id}:${track.streamIndex}`, label, baseUrl, track.streamIndex, false, subtitles));
    }
  }
  return entries;
}

function browseResponse(entries: readonly CatalogEntry[], total: number, updateId: number): SoapResponse {
  const didl = `<DIDL-Lite ${DIDL_NAMESPACES}>${entries.map((entry) => entry.xml).join("")}</DIDL-Lite>`;
  return reply(CONTENT_DIRECTORY, "Browse", `<Result>${escapeXml(didl)}</Result><NumberReturned>${entries.length}</NumberReturned><TotalMatches>${total}</TotalMatches><UpdateID>${updateId}</UpdateID>`);
}

function unsignedArgument(body: string, name: string): number | null {
  const raw = xmlValue(body, name);
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return value <= 0xffffffff ? value : null;
}

export function handleContentDirectorySoap(
  soapActionHeader: string | undefined, soapBody: string, catalog: readonly MediaItem[],
  session: ActiveSessionState, baseUrl: string
): SoapResponse {
  const body = xmlContents(soapBody, "Body");
  const action = bodyAction(body);
  if (soapActionHeader !== undefined &&
      soapActionHeader.trim().replace(/^"|"$/g, "") !== `${CONTENT_DIRECTORY}#${action}`) {
    return fault(401, "Invalid Action");
  }
  const updateId = session.updatedAt >>> 0;
  switch (action) {
    case "GetSearchCapabilities": return reply(CONTENT_DIRECTORY, action, "<SearchCaps></SearchCaps>");
    case "GetSortCapabilities": return reply(CONTENT_DIRECTORY, action, "<SortCaps></SortCaps>");
    case "GetSystemUpdateID": return reply(CONTENT_DIRECTORY, action, `<Id>${updateId}</Id>`);
    case "Browse": {
      const id = xmlValue(body, "ObjectID");
      const flag = xmlValue(body, "BrowseFlag");
      const start = unsignedArgument(body, "StartingIndex");
      const count = unsignedArgument(body, "RequestedCount");
      if (!id || start === null || count === null || (flag !== "BrowseMetadata" && flag !== "BrowseDirectChildren")) {
        return fault(402, "Invalid Args");
      }
      if (xmlValue(body, "SortCriteria")) return fault(709, "Unsupported or invalid sort criteria");
      const entries = buildEntries(catalog, session, baseUrl);
      if (flag === "BrowseMetadata") {
        const entry = id === "0"
          ? { id, xml: `<container id="0" parentID="-1" restricted="1" searchable="0" childCount="${entries.length}"><dc:title>Vídeos</dc:title><upnp:class>object.container</upnp:class></container>` }
          : entries.find((candidate) => candidate.id === id);
        return entry ? browseResponse([entry], 1, updateId) : fault(701, "No Such Object");
      }
      if (id !== "0") return entries.some((entry) => entry.id === id) ? fault(710, "No Such Container") : fault(701, "No Such Object");
      return browseResponse(entries.slice(start, count === 0 ? undefined : start + count), entries.length, updateId);
    }
    default: return fault(401, "Invalid Action");
  }
}

export function startSsdpMediaServerAnnouncer(lan: LanInterface, httpPort: number): { stop: () => void } {
  const announcer = dgram.createSocket("udp4");
  const listener = dgram.createSocket({ type: "udp4", reuseAddr: true });
  const location = `http://${lan.address}:${httpPort}/dlna/device.xml`;
  const common = [`CACHE-CONTROL: max-age=${MAX_AGE}`, `LOCATION: ${location}`, `SERVER: ${SERVER}`];
  let interval: NodeJS.Timeout | undefined;
  let stopped = false;

  function usn(target: string): string {
    return target === SERVER_UDN ? SERVER_UDN : `${SERVER_UDN}::${target}`;
  }

  function close(socket: dgram.Socket): void {
    try {
      socket.close();
    } catch {
      return;
    }
  }

  function announce(): void {
    for (const target of SSDP_TARGETS) {
      const message = ["NOTIFY * HTTP/1.1", `HOST: ${SSDP_HOST}:${SSDP_PORT}`, ...common,
        `NT: ${target}`, "NTS: ssdp:alive", `USN: ${usn(target)}`, "", ""].join("\r\n");
      announcer.send(message, SSDP_PORT, SSDP_HOST, () => {});
    }
  }

  announcer.on("error", () => close(announcer));
  announcer.on("close", () => clearInterval(interval));
  announcer.bind(0, lan.address, () => {
    if (stopped) return;
    try {
      announcer.setMulticastInterface(lan.address);
      announcer.setMulticastTTL(1);
      announce();
      interval = setInterval(announce, (MAX_AGE / 2) * 1000);
    } catch {
      close(announcer);
    }
  });

  listener.on("error", () => close(listener));
  listener.on("message", (packet, remote) => {
    if (stopped || !isIpInLanSubnet(remote.address, lan, false)) return;
    const message = packet.toString("utf8");
    if (!/^M-SEARCH \* HTTP\/1\.1\r?$/im.test(message) || !/^MAN:[ \t]*"ssdp:discover"[ \t]*\r?$/im.test(message)) return;
    const search = /^ST:[ \t]*([^\r\n]+)/im.exec(message)?.[1]?.trim().toLowerCase();
    const targets = search === "ssdp:all" ? SSDP_TARGETS : SSDP_TARGETS.filter((target) => target.toLowerCase() === search);
    for (const target of targets) {
      const response = ["HTTP/1.1 200 OK", ...common, `DATE: ${new Date().toUTCString()}`, "EXT:",
        `ST: ${target}`, `USN: ${usn(target)}`, "", ""].join("\r\n");
      listener.send(response, remote.port, remote.address, () => {});
    }
  });
  listener.bind(SSDP_PORT, lan.address, () => {
    if (stopped) return;
    try {
      listener.addMembership(SSDP_HOST, lan.address);
    } catch {
      close(listener);
    }
  });

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(interval);
      close(listener);
      close(announcer);
    }
  };
}
