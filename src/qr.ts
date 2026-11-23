export type QrErrorCorrectionLevel = "M" | "Q";

export interface QrMatrix {
  readonly version: number;
  readonly size: number;
  readonly ecc: QrErrorCorrectionLevel;
  readonly modules: readonly (readonly boolean[])[];
}

export interface QrSvgOptions {
  readonly ecc?: QrErrorCorrectionLevel;
  readonly quietZone?: number;
  readonly darkColor?: string;
  readonly lightColor?: string;
  readonly ariaLabel?: string;
}

interface EcSpec {
  readonly totalDataCodewords: number;
  readonly ecPerBlock: number;
  readonly blocks: readonly (readonly [count: number, dataCodewords: number])[];
}

// ISO/IEC 18004 Table 9 — Versions 1..10 for ECC M and Q
const EC_SPECS: Record<QrErrorCorrectionLevel, readonly EcSpec[]> = {
  M: [
    { totalDataCodewords: 16, ecPerBlock: 10, blocks: [[1, 16]] },
    { totalDataCodewords: 28, ecPerBlock: 16, blocks: [[1, 28]] },
    { totalDataCodewords: 44, ecPerBlock: 26, blocks: [[1, 44]] },
    { totalDataCodewords: 64, ecPerBlock: 18, blocks: [[2, 32]] },
    { totalDataCodewords: 86, ecPerBlock: 24, blocks: [[2, 43]] },
    { totalDataCodewords: 108, ecPerBlock: 16, blocks: [[4, 27]] },
    { totalDataCodewords: 124, ecPerBlock: 18, blocks: [[4, 31]] },
    { totalDataCodewords: 154, ecPerBlock: 22, blocks: [[2, 38], [2, 39]] },
    { totalDataCodewords: 182, ecPerBlock: 22, blocks: [[3, 36], [2, 37]] },
    { totalDataCodewords: 216, ecPerBlock: 26, blocks: [[4, 43], [1, 44]] }
  ],
  Q: [
    { totalDataCodewords: 13, ecPerBlock: 13, blocks: [[1, 13]] },
    { totalDataCodewords: 22, ecPerBlock: 22, blocks: [[1, 22]] },
    { totalDataCodewords: 34, ecPerBlock: 18, blocks: [[2, 17]] },
    { totalDataCodewords: 48, ecPerBlock: 26, blocks: [[2, 24]] },
    { totalDataCodewords: 62, ecPerBlock: 18, blocks: [[2, 15], [2, 16]] },
    { totalDataCodewords: 76, ecPerBlock: 24, blocks: [[4, 19]] },
    { totalDataCodewords: 88, ecPerBlock: 18, blocks: [[2, 14], [4, 15]] },
    { totalDataCodewords: 110, ecPerBlock: 22, blocks: [[4, 18], [2, 19]] },
    { totalDataCodewords: 132, ecPerBlock: 20, blocks: [[4, 16], [4, 17]] },
    { totalDataCodewords: 154, ecPerBlock: 24, blocks: [[6, 19], [2, 20]] }
  ]
};

const ALIGNMENT_CENTERS: readonly (readonly number[])[] = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50]
];

const EC_FORMAT_BITS: Record<QrErrorCorrectionLevel, number> = {
  M: 0b00,
  Q: 0b11
};

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255]!;
  }
}

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a]! + GF_LOG[b]!]!;
}

function rsGeneratorPoly(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    const factor = GF_EXP[i]!;
    for (let j = 0; j < poly.length; j++) {
      next[j] = next[j]! ^ poly[j]!;
      next[j + 1] = next[j + 1]! ^ gfMul(poly[j]!, factor);
    }
    poly = next;
  }
  return poly;
}

function rsComputeRemainder(data: Uint8Array, ecLen: number): Uint8Array {
  const gen = rsGeneratorPoly(ecLen);
  const rem = new Uint8Array(ecLen);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i]! ^ rem[0]!;
    for (let j = 0; j < ecLen - 1; j++) {
      rem[j] = rem[j + 1]!;
    }
    rem[ecLen - 1] = 0;
    if (factor !== 0) {
      for (let j = 0; j < ecLen; j++) {
        rem[j] = rem[j]! ^ gfMul(gen[j + 1]!, factor);
      }
    }
  }
  return rem;
}

function selectVersion(byteLength: number, ecc: QrErrorCorrectionLevel): { version: number; spec: EcSpec } {
  const specs = EC_SPECS[ecc];
  for (let idx = 0; idx < specs.length; idx++) {
    const version = idx + 1;
    const spec = specs[idx]!;
    const countBits = version <= 9 ? 8 : 16;
    const requiredBits = 4 + countBits + byteLength * 8;
    if (requiredBits <= spec.totalDataCodewords * 8) {
      return { version, spec };
    }
  }
  throw new Error(`Payload too large for QR versions 1..10 at ECC ${ecc} (${byteLength} bytes)`);
}

function encodeByteData(bytes: Uint8Array, version: number, totalDataCodewords: number): Uint8Array {
  const bits: number[] = [];
  const pushBits = (val: number, len: number): void => {
    for (let i = len - 1; i >= 0; i--) {
      bits.push((val >>> i) & 1);
    }
  };

  pushBits(0b0100, 4);
  pushBits(bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) {
    pushBits(b, 8);
  }

  const capacityBits = totalDataCodewords * 8;
  const terminatorLen = Math.min(4, capacityBits - bits.length);
  pushBits(0, terminatorLen);

  while (bits.length % 8 !== 0) {
    bits.push(0);
  }

  const codewords = new Uint8Array(totalDataCodewords);
  let byteIdx = 0;
  for (let i = 0; i < bits.length; i += 8) {
    let val = 0;
    for (let j = 0; j < 8; j++) {
      val = (val << 1) | bits[i + j]!;
    }
    codewords[byteIdx++] = val;
  }

  const padBytes = [0xec, 0x11];
  let padIdx = 0;
  while (byteIdx < totalDataCodewords) {
    codewords[byteIdx++] = padBytes[padIdx % 2]!;
    padIdx++;
  }
  return codewords;
}

function interleaveBlocks(dataCodewords: Uint8Array, spec: EcSpec): Uint8Array {
  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  let offset = 0;
  let maxDataLen = 0;

  for (const [count, dataLen] of spec.blocks) {
    if (dataLen > maxDataLen) maxDataLen = dataLen;
    for (let i = 0; i < count; i++) {
      const block = dataCodewords.subarray(offset, offset + dataLen);
      offset += dataLen;
      dataBlocks.push(block);
      ecBlocks.push(rsComputeRemainder(block, spec.ecPerBlock));
    }
  }

  const out: number[] = [];
  for (let i = 0; i < maxDataLen; i++) {
    for (const block of dataBlocks) {
      if (i < block.length) out.push(block[i]!);
    }
  }
  for (let i = 0; i < spec.ecPerBlock; i++) {
    for (const ec of ecBlocks) {
      out.push(ec[i]!);
    }
  }
  return Uint8Array.from(out);
}

function computeFormatBits(ecc: QrErrorCorrectionLevel, mask: number): number {
  const data = (EC_FORMAT_BITS[ecc] << 3) | (mask & 0x7);
  let rem = data << 10;
  for (let i = 14; i >= 10; i--) {
    if ((rem >>> i) & 1) {
      rem ^= 0x537 << (i - 10);
    }
  }
  return ((data << 10) | rem) ^ 0x5412;
}

function computeVersionBits(version: number): number {
  let rem = version << 12;
  for (let i = 17; i >= 12; i--) {
    if ((rem >>> i) & 1) {
      rem ^= 0x1f25 << (i - 12);
    }
  }
  return (version << 12) | rem;
}

function buildBaseMatrix(version: number): { modules: boolean[][]; isFunction: boolean[][] } {
  const size = version * 4 + 17;
  const modules: boolean[][] = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  const isFunction: boolean[][] = Array.from({ length: size }, () => Array<boolean>(size).fill(false));

  const setFn = (r: number, c: number, dark: boolean): void => {
    if (r < 0 || r >= size || c < 0 || c >= size) return;
    modules[r]![c] = dark;
    isFunction[r]![c] = true;
  };

  const drawFinder = (topR: number, topC: number): void => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = topR + dr;
        const c = topC + dc;
        if (r < 0 || r >= size || c < 0 || c >= size) continue;
        const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const dist = Math.max(Math.abs(dr - 3), Math.abs(dc - 3));
        const dark = inOuter && (dist === 0 || dist === 1 || dist === 3);
        setFn(r, c, dark);
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  for (let i = 8; i < size - 8; i++) {
    setFn(6, i, i % 2 === 0);
    setFn(i, 6, i % 2 === 0);
  }

  const centers = ALIGNMENT_CENTERS[version - 1] ?? [];
  for (const cr of centers) {
    for (const cc of centers) {
      const overlapsFinder =
        (cr <= 8 && cc <= 8) ||
        (cr <= 8 && cc >= size - 8) ||
        (cr >= size - 8 && cc <= 8);
      if (overlapsFinder) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dist = Math.max(Math.abs(dr), Math.abs(dc));
          setFn(cr + dr, cc + dc, dist !== 1);
        }
      }
    }
  }

  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      setFn(8, i, false);
      setFn(i, 8, false);
    }
  }
  for (let i = size - 8; i < size; i++) {
    setFn(8, i, false);
    setFn(i, 8, false);
  }
  setFn(size - 8, 8, true);

  if (version >= 7) {
    const bits = computeVersionBits(version);
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFn(b, a, dark);
      setFn(a, b, dark);
    }
  }

  return { modules, isFunction };
}

function writeFormatInfo(modules: boolean[][], ecc: QrErrorCorrectionLevel, mask: number): void {
  const size = modules.length;
  const bits = computeFormatBits(ecc, mask);

  for (let i = 0; i <= 5; i++) modules[i]![8] = ((bits >>> i) & 1) === 1;
  modules[7]![8] = ((bits >>> 6) & 1) === 1;
  modules[8]![8] = ((bits >>> 7) & 1) === 1;
  modules[8]![7] = ((bits >>> 8) & 1) === 1;
  for (let i = 9; i < 15; i++) modules[8]![14 - i] = ((bits >>> i) & 1) === 1;

  for (let i = 0; i < 8; i++) modules[8]![size - 1 - i] = ((bits >>> i) & 1) === 1;
  for (let i = 8; i < 15; i++) modules[size - 15 + i]![8] = ((bits >>> i) & 1) === 1;
  modules[size - 8]![8] = true;
}

function placeCodewords(
  modules: boolean[][],
  isFunction: boolean[][],
  codewords: Uint8Array
): void {
  const size = modules.length;
  let bitIdx = 0;
  const totalBits = codewords.length * 8;
  let upward = true;

  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step++) {
      const r = upward ? size - 1 - step : step;
      for (let dx = 0; dx < 2; dx++) {
        const c = right - dx;
        if (isFunction[r]![c]) continue;
        let dark = false;
        if (bitIdx < totalBits) {
          dark = ((codewords[bitIdx >>> 3]! >>> (7 - (bitIdx & 7))) & 1) === 1;
        }
        modules[r]![c] = dark;
        bitIdx++;
      }
    }
    upward = !upward;
  }
}

function maskBit(mask: number, r: number, c: number): boolean {
  switch (mask) {
    case 0:
      return (r + c) % 2 === 0;
    case 1:
      return r % 2 === 0;
    case 2:
      return c % 3 === 0;
    case 3:
      return (r + c) % 3 === 0;
    case 4:
      return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5:
      return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6:
      return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    case 7:
      return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    default:
      return false;
  }
}

function applyMask(
  base: boolean[][],
  isFunction: boolean[][],
  ecc: QrErrorCorrectionLevel,
  mask: number
): boolean[][] {
  const size = base.length;
  const out = base.map((row, r) =>
    row.map((dark, c) => (isFunction[r]![c] ? dark : dark !== maskBit(mask, r, c)))
  );
  writeFormatInfo(out, ecc, mask);
  return out;
}

function countFinderLikePatterns(line: readonly boolean[]): number {
  let count = 0;
  const n = line.length;
  for (let i = 0; i <= n - 11; i++) {
    const p1 =
      line[i] && !line[i + 1] && line[i + 2] && line[i + 3] && line[i + 4] && !line[i + 5] && line[i + 6] &&
      !line[i + 7] && !line[i + 8] && !line[i + 9] && !line[i + 10];
    const p2 =
      !line[i] && !line[i + 1] && !line[i + 2] && !line[i + 3] &&
      line[i + 4] && !line[i + 5] && line[i + 6] && line[i + 7] && line[i + 8] && !line[i + 9] && line[i + 10];
    if (p1 || p2) count++;
  }
  return count;
}

function evaluatePenalty(modules: readonly (readonly boolean[])[]): number {
  const size = modules.length;
  let penalty = 0;

  for (let r = 0; r < size; r++) {
    let runLen = 1;
    let prev = modules[r]![0]!;
    for (let c = 1; c < size; c++) {
      const cur = modules[r]![c]!;
      if (cur === prev) {
        runLen++;
      } else {
        if (runLen >= 5) penalty += 3 + (runLen - 5);
        prev = cur;
        runLen = 1;
      }
    }
    if (runLen >= 5) penalty += 3 + (runLen - 5);
  }
  for (let c = 0; c < size; c++) {
    let runLen = 1;
    let prev = modules[0]![c]!;
    for (let r = 1; r < size; r++) {
      const cur = modules[r]![c]!;
      if (cur === prev) {
        runLen++;
      } else {
        if (runLen >= 5) penalty += 3 + (runLen - 5);
        prev = cur;
        runLen = 1;
      }
    }
    if (runLen >= 5) penalty += 3 + (runLen - 5);
  }

  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = modules[r]![c]!;
      if (v === modules[r]![c + 1] && v === modules[r + 1]![c] && v === modules[r + 1]![c + 1]) {
        penalty += 3;
      }
    }
  }

  for (let r = 0; r < size; r++) {
    penalty += countFinderLikePatterns(modules[r]!) * 40;
  }
  const col = new Array<boolean>(size);
  for (let c = 0; c < size; c++) {
    for (let r = 0; r < size; r++) col[r] = modules[r]![c]!;
    penalty += countFinderLikePatterns(col) * 40;
  }

  let darkCount = 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (modules[r]![c]) darkCount++;
    }
  }
  const total = size * size;
  const k = Math.floor(Math.abs(darkCount * 20 - total * 10) / total);
  penalty += k * 10;

  return penalty;
}

export function generateQrMatrix(
  text: string,
  ecc: QrErrorCorrectionLevel = "M"
): QrMatrix {
  const bytes = new TextEncoder().encode(text);
  const { version, spec } = selectVersion(bytes.length, ecc);
  const dataCodewords = encodeByteData(bytes, version, spec.totalDataCodewords);
  const finalCodewords = interleaveBlocks(dataCodewords, spec);

  const { modules: base, isFunction } = buildBaseMatrix(version);
  placeCodewords(base, isFunction, finalCodewords);

  let bestMask = 0;
  let bestPenalty = Number.POSITIVE_INFINITY;
  let bestModules: boolean[][] = base;

  for (let mask = 0; mask < 8; mask++) {
    const candidate = applyMask(base, isFunction, ecc, mask);
    const score = evaluatePenalty(candidate);
    if (score < bestPenalty) {
      bestPenalty = score;
      bestMask = mask;
      bestModules = candidate;
    }
  }

  void bestMask;
  return {
    version,
    size: bestModules.length,
    ecc,
    modules: bestModules
  };
}

function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderQrSvg(text: string, options: QrSvgOptions = {}): string {
  const ecc = options.ecc ?? "M";
  const quietZone = Math.max(4, Math.floor(options.quietZone ?? 4));
  const darkColor = options.darkColor ?? "#000000";
  const lightColor = options.lightColor ?? "#ffffff";
  const ariaLabel = options.ariaLabel ?? `QR Code para ${text}`;

  const qr = generateQrMatrix(text, ecc);
  const total = qr.size + quietZone * 2;
  const pathSegments: string[] = [];

  for (let r = 0; r < qr.size; r++) {
    const row = qr.modules[r]!;
    let c = 0;
    while (c < qr.size) {
      if (!row[c]) {
        c++;
        continue;
      }
      const start = c;
      while (c < qr.size && row[c]) c++;
      const runWidth = c - start;
      pathSegments.push(`M${start + quietZone} ${r + quietZone}h${runWidth}v1h-${runWidth}z`);
    }
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges" role="img" aria-label="${escapeXmlAttr(ariaLabel)}" data-qr-version="${qr.version}" data-qr-ecc="${qr.ecc}" data-qr-quiet-zone="${quietZone}" data-qr-modules="${qr.size}">`,
    `<rect width="${total}" height="${total}" fill="${escapeXmlAttr(lightColor)}"/>`,
    `<path fill="${escapeXmlAttr(darkColor)}" d="${pathSegments.join("")}"/>`,
    `</svg>`
  ].join("");
}
