/*
 * Product IDs: the number (or code) every product carries, unique within a company. Stored in
 * `items.code`. A company either types its own or lets the app hand out the next number.
 */

export interface ProductIdFormat {
  /** Put in front of the number, e.g. "P-". May be empty. */
  prefix: string;
  /** Pad the number with zeros to at least this many digits; 0 = no padding. */
  digits: number;
}

/**
 * A code longer than this many digits is somebody's barcode or part number, not a step in our own
 * sequence: counting from it would jump the numbering to 8901030865279 for ever (and overflow).
 */
const MAX_SEQUENCE_DIGITS = 9;

/** The number a code contributes to the sequence, or null if it isn't part of it. */
export function sequenceNumber(code: string, prefix: string): number | null {
  if (code.slice(0, prefix.length).toLowerCase() !== prefix.toLowerCase()) return null;
  const rest = code.slice(prefix.length);
  if (rest.length === 0 || rest.length > MAX_SEQUENCE_DIGITS || !/^[0-9]+$/.test(rest)) return null;
  return Number(rest);
}

/** Number 12 as an ID: prefix "P-", 4 digits → "P-0012". */
export function formatProductId(n: number, format: ProductIdFormat): string {
  return format.prefix + String(n).padStart(format.digits, "0");
}

/** The next ID after the highest one already used with this prefix. */
export function nextProductId(existing: Iterable<string>, format: ProductIdFormat): string {
  const taken = new Set<string>();
  let highest = 0;
  for (const code of existing) {
    taken.add(code.toLowerCase());
    const n = sequenceNumber(code, format.prefix);
    if (n !== null && n > highest) highest = n;
  }
  // Padding can make "0012" collide with a typed "0012" that the rule above read as 12, and a
  // longer hand-typed code can sit just ahead; step past anything already taken.
  for (let n = highest + 1; ; n++) {
    const id = formatProductId(n, format);
    if (!taken.has(id.toLowerCase())) return id;
  }
}

/** How a product is written everywhere: its ID, then its name, on one line ("132 iphone bag"). */
export function productLabel(code: string | null | undefined, name: string): string {
  return code ? `${code} ${name}` : name;
}
