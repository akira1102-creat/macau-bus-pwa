import { MACAU_BOUNDS, ParkingFacilitySchema, type ParkingFacility } from '../../shared/parking-contract';

const ROW_PATTERN = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
const IMAGE_PATTERN = /<img\b[^>]*>/gi;
const DATE_PATTERN = /\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(Z|[+-]\d{2}:?\d{2}))?/i;

type SpaceKey = 'car' | 'motorcycle' | 'electricCar' | 'electricMotorcycle' | 'accessible';

export interface ParkingDetail {
  location: string | null;
  entrance: string | null;
  latitude: number | null;
  longitude: number | null;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(x[\da-f]+|\d+);?/gi, (_match, code: string) => {
      const parsed = code.toLowerCase().startsWith('x')
        ? Number.parseInt(code.slice(1), 16)
        : Number.parseInt(code, 10);
      if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 0x10ffff) {
        return ' ';
      }
      try {
        return String.fromCodePoint(parsed);
      } catch {
        return ' ';
      }
    });
}

function withoutNonContent(value: string): string {
  return value
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ');
}

function normalizeText(value: string): string {
  return decodeHtmlEntities(withoutNonContent(value).replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function nullableText(value: string): string | null {
  const normalized = normalizeText(value);
  return normalized || null;
}

function extractAttribute(tag: string, attribute: string): string | null {
  const pattern = new RegExp(`\\b${attribute}\\s*=\\s*["']([^"']*)["']`, 'i');
  return tag.match(pattern)?.[1] ?? null;
}

function spaceKeyFromValue(value: string): SpaceKey | undefined {
  const normalized = value
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
  if (normalized.includes('emotor') || normalized.includes('electricmotorcycle')) return 'electricMotorcycle';
  if (normalized.includes('ecar') || normalized.includes('electriccar')) return 'electricCar';
  if (normalized.includes('disabled') || normalized.includes('accessible') || normalized.includes('handicap')) return 'accessible';
  if (normalized.includes('motor') || normalized.includes('motorcycle')) return 'motorcycle';
  if (normalized === 'car' || normalized.includes('carparkcar') || normalized.includes('privatecar')) return 'car';
  return undefined;
}

function parseCount(value: string): number | null {
  const normalized = normalizeText(value).replace(/,/g, '');
  if (!normalized || /^(?:-|—|–|n\/?a|unknown|暫停|停用|關閉|維修)$/i.test(normalized)) {
    return null;
  }
  if (!/^\d+$/.test(normalized)) return null;
  const parsed = Number.parseInt(normalized, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseUpdatedAt(row: string): string | null {
  const match = row.match(DATE_PATTERN);
  if (!match) return null;
  const year = match[1] ?? '';
  const month = match[2] ?? '';
  const day = match[3] ?? '';
  const hour = match[4] ?? '';
  const minute = match[5] ?? '';
  const second = match[6] ?? '00';
  const offset = match[7];
  const padded = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute}:${second.padStart(2, '0')}`;
  if (offset) {
    const normalizedOffset = offset.toUpperCase() === 'Z'
      ? 'Z'
      : `${offset.slice(0, 3)}:${offset.slice(-2)}`;
    const candidate = `${padded}${normalizedOffset}`;
    return Number.isNaN(Date.parse(candidate)) ? null : candidate;
  }
  const candidate = `${padded}+08:00`;
  return Number.isNaN(Date.parse(candidate)) ? null : candidate;
}

function extractFacilityName(row: string): string | null {
  const styleMatch = row.match(/<span\b[^>]*\bclass\s*=\s*["'][^"']*\bstyle7\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
  if (styleMatch?.[1]) return nullableText(styleMatch[1]);

  const dataName = row.match(/\bdata-name\s*=\s*["']([^"']*)["']/i)?.[1];
  if (dataName) return nullableText(dataName);

  const heading = row.match(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i)?.[1];
  if (heading) return nullableText(heading);

  const firstCell = row.match(/<td\b[^>]*>([\s\S]*?)<\/td>/i)?.[1];
  if (!firstCell) return null;
  const beforeImage = firstCell.split(/<img\b/i, 1)[0] ?? firstCell;
  const text = normalizeText(beforeImage).replace(DATE_PATTERN, ' ');
  return text || null;
}

function extractOfficialId(row: string): string | null {
  const decoded = decodeHtmlEntities(row);
  const fromDetail = decoded.match(/carpark_detail\.aspx\b[^"']*?\bid\s*=\s*(\d+)/i)?.[1];
  if (fromDetail) return fromDetail;
  const dataId = decoded.match(/\bdata-(?:parking-)?id\s*=\s*["'](\d+)["']/i)?.[1];
  return dataId ?? null;
}

function extractSpaces(row: string): Record<SpaceKey, number | null> {
  const spaces: Record<SpaceKey, number | null> = {
    car: null,
    motorcycle: null,
    electricCar: null,
    electricMotorcycle: null,
    accessible: null,
  };
  const images = [...row.matchAll(IMAGE_PATTERN)];
  for (const [index, image] of images.entries()) {
    const tag = image[0] ?? '';
    const source = extractAttribute(tag, 'src') ?? '';
    const alt = extractAttribute(tag, 'alt') ?? '';
    const key = spaceKeyFromValue(`${source} ${alt}`);
    if (!key || image.index === undefined) continue;
    const nextImageIndex = images[index + 1]?.index ?? row.length;
    const valueSegment = row.slice(image.index + tag.length, nextImageIndex);
    const value = parseCount(valueSegment);
    if (value !== null || spaces[key] === null) {
      spaces[key] = value;
    }
  }

  for (const attribute of ['data-space', 'data-space-type', 'data-type']) {
    const pattern = new RegExp(`<[^>]+\\b${attribute}\\s*=\\s*["']([^"']+)["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, 'gi');
    for (const match of row.matchAll(pattern)) {
      const key = spaceKeyFromValue(match[1] ?? '');
      if (key) spaces[key] = parseCount(match[2] ?? '');
    }
  }
  return spaces;
}

function isSuspended(row: string): boolean {
  const decoded = decodeHtmlEntities(row);
  const explicit = decoded.match(/\bdata-suspended\s*=\s*["']([^"']+)["']/i)?.[1];
  if (explicit && /^(?:true|yes|1)$/i.test(explicit.trim())) return true;
  return /(?:暫停|停用|關閉|維修|suspend(?:ed)?|closed|unavailable)/i.test(normalizeText(row));
}

function emptySpaces(): Record<SpaceKey, number | null> {
  return {
    car: null,
    motorcycle: null,
    electricCar: null,
    electricMotorcycle: null,
    accessible: null,
  };
}

export function parseParkingRealtimeHtml(html: string): ParkingFacility[] {
  if (typeof html !== 'string' || !html.trim()) return [];
  const facilities: ParkingFacility[] = [];
  const seenIds = new Set<string>();
  for (const match of html.matchAll(ROW_PATTERN)) {
    const row = match[1] ?? '';
    const id = extractOfficialId(row);
    const name = extractFacilityName(row);
    if (!id || !name || seenIds.has(id)) continue;
    const spaces = { ...emptySpaces(), ...extractSpaces(row) };
    const candidate = {
      id,
      name,
      location: null,
      entrance: null,
      latitude: null,
      longitude: null,
      spaces,
      updatedAt: parseUpdatedAt(row),
      suspended: isSuspended(row),
    };
    const parsed = ParkingFacilitySchema.safeParse(candidate);
    if (!parsed.success) continue;
    seenIds.add(id);
    facilities.push(parsed.data);
  }
  return facilities;
}

function coordinateInBounds(latitude: number, longitude: number): boolean {
  return Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= MACAU_BOUNDS.minLatitude
    && latitude <= MACAU_BOUNDS.maxLatitude
    && longitude >= MACAU_BOUNDS.minLongitude
    && longitude <= MACAU_BOUNDS.maxLongitude;
}

function parseCoordinatePair(html: string): { latitude: number | null; longitude: number | null } {
  const latitudeValue = html.match(/\b(?:data-)?(?:latitude|lat)\s*=\s*["']\s*(-?\d+(?:\.\d+)?)\s*["']/i)?.[1]
    ?? html.match(/\b(?:latitude|lat)\s*[:=]\s*(-?\d+(?:\.\d+)?)/i)?.[1];
  const longitudeValue = html.match(/\b(?:data-)?(?:longitude|lng|lon)\s*=\s*["']\s*(-?\d+(?:\.\d+)?)\s*["']/i)?.[1]
    ?? html.match(/\b(?:longitude|lng|lon)\s*[:=]\s*(-?\d+(?:\.\d+)?)/i)?.[1];
  let latitude = latitudeValue === undefined ? Number.NaN : Number(latitudeValue);
  let longitude = longitudeValue === undefined ? Number.NaN : Number(longitudeValue);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    const query = decodeHtmlEntities(html).match(/[?&](?:q|query)=(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)/i);
    if (query) {
      latitude = Number(query[1]);
      longitude = Number(query[2]);
    }
  }
  if (!coordinateInBounds(latitude, longitude)) {
    return { latitude: null, longitude: null };
  }
  return { latitude, longitude };
}

function parseDetailRows(html: string): { location: string | null; entrance: string | null } {
  let location: string | null = null;
  let entrance: string | null = null;
  for (const row of html.matchAll(ROW_PATTERN)) {
    const cells = [...(row[1] ?? '').matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => cell[1] ?? '');
    if (cells.length < 2) continue;
    const label = normalizeText(cells[0] ?? '');
    const value = nullableText(cells.slice(1).join(' '));
    if (!value) continue;
    if (label.includes('停車場位置') || label === '位置') location = value;
    if (label.includes('出入口位置') || label.includes('入口位置')) entrance = value;
  }
  return { location, entrance };
}

export function parseParkingDetailHtml(html: string): ParkingDetail {
  if (typeof html !== 'string' || !html.trim()) {
    return { location: null, entrance: null, latitude: null, longitude: null };
  }
  const textValues = parseDetailRows(html);
  const coordinates = parseCoordinatePair(html);
  return { ...textValues, ...coordinates };
}
