import "server-only";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { BillFile } from "./read-bill";

/*
 * Reading the text off a bill on our own server, for free: PDFs that carry real text are read exactly with
 * pdftotext; photos and scanned PDFs go through Tesseract after a little cleaning (grey, contrast, enlarged).
 * Only the text is then sent to the AI, which costs far fewer tokens than sending the picture.
 * Both programs are installed in the app's image (deploy/app.Dockerfile); where they're missing `ocrAvailable`
 * is false and the bot reads the photo with a vision model instead. Tests swap this for a fake.
 */

export interface OcrResult {
  text: string;
  /** Tesseract's average confidence for the words it found, 0–100 (100 for text taken straight from a PDF). */
  confidence: number;
  source: "pdf-text" | "ocr";
}

export interface Ocr {
  available(): Promise<boolean>;
  extract(files: BillFile[]): Promise<OcrResult>;
}

const run = (cmd: string, args: string[], opts: { input?: Buffer; timeout?: number } = {}) =>
  new Promise<Buffer>((resolve, reject) => {
    const p = execFile(cmd, args, { encoding: "buffer", maxBuffer: 32 * 1024 * 1024, timeout: opts.timeout ?? 90_000 }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
    if (opts.input) p.stdin?.end(opts.input);
    else p.stdin?.end();
  });

/** Text rows from `tesseract … tsv`: words joined into lines (by block/paragraph/line), plus the mean word confidence. */
export function parseTsv(tsv: string): { text: string; confidence: number } {
  const lines = new Map<string, string[]>();
  const order: string[] = [];
  let sum = 0;
  let n = 0;
  for (const row of tsv.split("\n").slice(1)) {
    const c = row.split("\t");
    if (c.length < 12 || c[0] !== "5") continue; // level 5 = a word
    const word = c.slice(11).join("\t").trim();
    const conf = Number(c[10]);
    if (!word || !Number.isFinite(conf) || conf < 0) continue;
    const key = `${c[2]}.${c[3]}.${c[4]}`;
    if (!lines.has(key)) {
      lines.set(key, []);
      order.push(key);
    }
    lines.get(key)!.push(word);
    sum += conf;
    n++;
  }
  return { text: order.map((k) => lines.get(k)!.join(" ")).join("\n"), confidence: n ? Math.round(sum / n) : 0 };
}

/** Greyscale, stretched contrast, enlarged to a width where Tesseract reads small print well. */
async function clean(data: Buffer): Promise<Buffer> {
  try {
    const sharp = (await import("sharp")).default;
    const img = sharp(data, { failOn: "none" }).rotate(); // honour the camera's orientation
    const { width = 0 } = await img.metadata();
    let p = img.greyscale().normalise();
    if (width > 0 && width < 2200) p = p.resize({ width: 2200, kernel: "lanczos3" });
    return await p.sharpen().png().toBuffer();
  } catch {
    return data; // sharp unavailable or the file is odd: let Tesseract try the original
  }
}

async function ocrImage(data: Buffer): Promise<{ text: string; confidence: number }> {
  const out = await run("tesseract", ["stdin", "stdout", "-l", "eng", "--psm", "6", "--dpi", "300", "tsv"], { input: await clean(data) });
  return parseTsv(out.toString("utf8"));
}

const MAX_PDF_PAGES = 4;

async function pdfText(data: Buffer): Promise<{ text: string; confidence: number; source: "pdf-text" | "ocr" }> {
  const dir = await mkdtemp(path.join(tmpdir(), "bill-"));
  try {
    const file = path.join(dir, "bill.pdf");
    await writeFile(file, data);
    const text = (await run("pdftotext", ["-layout", "-l", String(MAX_PDF_PAGES), file, "-"]).catch(() => Buffer.alloc(0))).toString("utf8").trim();
    if (text.replace(/\s/g, "").length >= 120) return { text, confidence: 100, source: "pdf-text" };
    // A scanned PDF has no text layer: draw its pages and read them like photos.
    await run("pdftoppm", ["-r", "200", "-l", String(MAX_PDF_PAGES), "-png", file, path.join(dir, "page")]);
    const pages = (await readdir(dir)).filter((f) => f.startsWith("page") && f.endsWith(".png")).sort();
    const parts: { text: string; confidence: number }[] = [];
    for (const f of pages) parts.push(await ocrImage(await readFile(path.join(dir, f))));
    return { text: parts.map((p) => p.text).join("\n\n"), confidence: parts.length ? Math.round(parts.reduce((a, p) => a + p.confidence, 0) / parts.length) : 0, source: "ocr" };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

let installed: boolean | null = null;

const realOcr: Ocr = {
  async available() {
    if (installed === null) {
      installed = await Promise.all([run("tesseract", ["--version"], { timeout: 10_000 }), run("pdftotext", ["-v"], { timeout: 10_000 })]).then(
        () => true,
        () => false,
      );
    }
    return installed;
  },
  async extract(files) {
    const parts: { text: string; confidence: number; source: "pdf-text" | "ocr" }[] = [];
    for (const f of files) parts.push(f.mime === "application/pdf" ? await pdfText(f.data) : { ...(await ocrImage(f.data)), source: "ocr" as const });
    const text = parts.map((p) => p.text.trim()).filter(Boolean).join("\n\n--- next page ---\n\n");
    const confidence = parts.length ? Math.round(parts.reduce((a, p) => a + p.confidence, 0) / parts.length) : 0;
    return { text, confidence, source: parts.every((p) => p.source === "pdf-text") ? "pdf-text" : "ocr" };
  },
};

let ocr: Ocr = realOcr;

/** Tests only: replace the OCR. Pass nothing to go back to the real one. */
export function setOcr(o?: Ocr) {
  ocr = o ?? realOcr;
}

export const billOcr = () => ocr;
