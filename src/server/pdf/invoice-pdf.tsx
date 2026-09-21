import path from "node:path";
import { Document, Font, Image, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { InvoiceModel } from "../invoice";

const fontFile = (n: string) => path.join(process.cwd(), "assets", "fonts", n);
Font.register({
  family: "NotoSans",
  fonts: [
    { src: fontFile("NotoSans-Regular.ttf"), fontWeight: 400 },
    { src: fontFile("NotoSans-Bold.ttf"), fontWeight: 700 },
  ],
});
Font.register({
  family: "Tajawal",
  fonts: [
    { src: fontFile("Tajawal-Regular.ttf"), fontWeight: 400 },
    { src: fontFile("Tajawal-Bold.ttf"), fontWeight: 700 },
  ],
});
Font.registerHyphenationCallback((w) => [w]);
/** Latin text uses Noto Sans; anything Arabic falls through to Tajawal. */
const FAMILY = ["NotoSans", "Tajawal"] as unknown as string;

const ink = "#1a2230";
const muted = "#5b6675";
const line = "#cfd6df";

function makeStyles(accent: string, modern: boolean) {
  return StyleSheet.create({
    page: { paddingTop: 28, paddingBottom: 46, paddingHorizontal: 30, fontFamily: FAMILY, fontSize: 9, color: ink },
    head: modern
      ? { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: accent, marginHorizontal: -30, marginTop: -28, paddingHorizontal: 30, paddingVertical: 16, marginBottom: 14 }
      : { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 1.5, borderBottomColor: accent, paddingBottom: 8, marginBottom: 10 },
    sellerName: { fontSize: 15, fontWeight: 700, color: modern ? "#ffffff" : accent },
    sellerText: { fontSize: 8.5, color: modern ? "#ffffffcc" : muted, lineHeight: 1.35 },
    title: { fontSize: 14, fontWeight: 700, textAlign: "right", color: modern ? "#ffffff" : accent },
    titleSub: { fontSize: 8.5, textAlign: "right", color: modern ? "#ffffffcc" : muted },
    cancelled: { color: modern ? "#ffd7d3" : "#b3261e" },
    small: { fontSize: 8.5, color: muted, lineHeight: 1.35 },
    bold: { fontWeight: 700 },
    twoCol: { flexDirection: "row", gap: 12, marginBottom: 10 },
    box: { flex: 1, borderWidth: 0.75, borderColor: line, borderRadius: modern ? 6 : 3, padding: 7 },
    boxHead: { fontSize: 7.5, color: modern ? accent : muted, textTransform: "uppercase", marginBottom: 3, fontWeight: 700 },
    metaRow: { flexDirection: "row", marginBottom: 1.5 },
    metaK: { width: 88, color: muted },
    thead: modern
      ? { flexDirection: "row", backgroundColor: accent }
      : { flexDirection: "row", backgroundColor: "#eef2f7", borderTopWidth: 0.75, borderBottomWidth: 0.75, borderColor: line },
    th: { fontWeight: 700, fontSize: 8, color: modern ? "#ffffff" : ink },
    row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: line },
    rowAlt: { backgroundColor: modern ? "#f6f8fb" : "#ffffff" },
    cell: { paddingVertical: 4, paddingHorizontal: 3 },
    right: { textAlign: "right" },
    totalsWrap: { flexDirection: "row", justifyContent: "space-between", marginTop: 8, gap: 14 },
    totals: { width: 210 },
    totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
    grand: modern
      ? { backgroundColor: accent, paddingHorizontal: 6, paddingVertical: 4, marginVertical: 2, borderRadius: 3 }
      : { borderTopWidth: 1, borderBottomWidth: 1, borderColor: ink, paddingVertical: 4, marginVertical: 2 },
    grandText: { fontWeight: 700, color: modern ? "#ffffff" : ink },
    footer: { position: "absolute", bottom: 20, left: 30, right: 30, flexDirection: "row", justifyContent: "space-between", fontSize: 7.5, color: muted },
    qr: { width: 82, height: 82 },
    logo: { maxHeight: 44, maxWidth: 120, objectFit: "contain", marginRight: 10 },
    ar: { textAlign: "right", fontFamily: FAMILY },
    sign: { maxHeight: 40, maxWidth: 110, objectFit: "contain", alignSelf: "flex-end", marginBottom: 2 },
  });
}

function Cell({ s, w, children, right, bold }: { s: ReturnType<typeof makeStyles>; w: number | string; children?: React.ReactNode; right?: boolean; bold?: boolean }) {
  return (
    <View style={[s.cell, { width: typeof w === "number" ? `${w}%` : w }]}>
      <Text style={[right ? s.right : {}, bold ? s.bold : {}]}>{children}</Text>
    </View>
  );
}

function Sheet({ m }: { m: InvoiceModel }) {
  const modern = m.layout === "modern";
  const s = makeStyles(m.accent, modern);
  const c = m.columns;
  const w = { no: 4, hsn: c.hsn ? 9 : 0, qty: 10, rate: 11, disc: c.discount ? 9 : 0, taxable: 12, taxrate: c.tax ? 7 : 0, tax: c.tax ? 10 : 0, total: 12 };
  const desc = 100 - Object.values(w).reduce((a, b) => a + b, 0);
  const th = (t: string, ww: number | string, right?: boolean) => (
    <Cell s={s} w={ww} right={right}>
      <Text style={s.th}>{t}</Text>
    </Cell>
  );

  return (
    <Document title={m.title} author={m.seller.name}>
      <Page size={m.paper === "A5" ? "A5" : "A4"} style={s.page} wrap>
        <View style={s.head}>
          <View style={{ flexDirection: "row", alignItems: "center", maxWidth: "64%" }}>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt */}
            {m.logo && <Image src={m.logo} style={s.logo} />}
            <View>
              <Text style={s.sellerName}>{m.seller.name}</Text>
              {m.seller.nameAr && <Text style={[s.sellerName, s.ar, { fontSize: 13 }]}>{m.seller.nameAr}</Text>}
              {m.seller.lines.map((l, i) => (
                <Text key={i} style={s.sellerText}>
                  {l}
                </Text>
              ))}
              {m.seller.linesAr.map((l, i) => (
                <Text key={`a${i}`} style={[s.sellerText, s.ar]}>
                  {l}
                </Text>
              ))}
              {m.seller.taxId && (
                <Text style={[s.sellerText, s.bold]}>
                  {m.seller.taxIdLabel}: {m.seller.taxId}
                </Text>
              )}
            </View>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={[s.title, m.cancelled ? s.cancelled : {}]}>{m.title}</Text>
            <Text style={s.titleSub}>{m.ui["Amounts in"]} {m.currency}</Text>
          </View>
        </View>

        <View style={s.twoCol}>
          {(m.party.name || m.party.lines.length > 0) && (
            <View style={s.box}>
              <Text style={s.boxHead}>{m.party.heading}</Text>
              <Text style={s.bold}>{m.party.name}</Text>
              {m.party.nameAr && <Text style={[s.bold, s.ar]}>{m.party.nameAr}</Text>}
              {m.party.lines.map((l, i) => (
                <Text key={i} style={s.small}>
                  {l}
                </Text>
              ))}
              {m.party.linesAr.map((l, i) => (
                <Text key={`a${i}`} style={[s.small, s.ar]}>
                  {l}
                </Text>
              ))}
              {m.party.taxId && (
                <Text style={s.small}>
                  {m.party.taxIdLabel}: {m.party.taxId}
                </Text>
              )}
            </View>
          )}
          <View style={s.box}>
            {m.meta.map((r) => (
              <View key={r.k} style={s.metaRow}>
                <Text style={s.metaK}>{r.k}</Text>
                <Text style={s.bold}>{r.v}</Text>
              </View>
            ))}
          </View>
        </View>

        {m.kind === "invoice" ? (
          <>
            <View style={s.thead} fixed>
              {th("#", w.no)}
              {th(m.ui.Item, desc)}
              {c.hsn && th(m.ui.HSN, w.hsn)}
              {th(m.ui.Qty, w.qty, true)}
              {th(m.ui.Rate, w.rate, true)}
              {c.discount && th(m.ui.Discount, w.disc, true)}
              {th(m.ui.Taxable, w.taxable, true)}
              {c.tax && th(m.ui["Tax %"], w.taxrate, true)}
              {c.tax && th(m.ui.Tax, w.tax, true)}
              {th(m.ui.Amount, w.total, true)}
            </View>
            {m.lines.map((l, i) => (
              <View key={l.no} style={[s.row, i % 2 ? s.rowAlt : {}]} wrap={false}>
                <Cell s={s} w={w.no}>{l.no}</Cell>
                <View style={[s.cell, { width: `${desc}%` }]}>
                  <Text>{l.desc}</Text>
                  {l.descAr && <Text style={s.ar}>{l.descAr}</Text>}
                </View>
                {c.hsn && <Cell s={s} w={w.hsn}>{l.hsn}</Cell>}
                <Cell s={s} w={w.qty} right>{l.qty}</Cell>
                <Cell s={s} w={w.rate} right>{l.rate}</Cell>
                {c.discount && <Cell s={s} w={w.disc} right>{l.discount}</Cell>}
                <Cell s={s} w={w.taxable} right>{l.taxable}</Cell>
                {c.tax && <Cell s={s} w={w.taxrate} right>{l.taxRate}</Cell>}
                {c.tax && <Cell s={s} w={w.tax} right>{l.tax}</Cell>}
                <Cell s={s} w={w.total} right bold>{l.total}</Cell>
              </View>
            ))}

            <View style={s.totalsWrap} wrap={false}>
              <View style={{ flex: 1 }}>
                <Text style={s.boxHead}>{m.ui["Amount in words"]}</Text>
                <Text style={s.bold}>{m.words}</Text>
                {m.wordsAr && <Text style={[s.bold, s.ar]}>{m.wordsAr}</Text>}
                {m.taxSummary.length > 0 && (
                  <View style={{ marginTop: 8 }}>
                    <View style={s.thead}>
                      {th(m.ui.Rate, "16%")}
                      {th(m.ui.Taxable, "24%", true)}
                      {m.split && th(m.taxLabels.cgst, "20%", true)}
                      {m.split && th(m.taxLabels.sgst, "20%", true)}
                      {!m.split && th(m.taxLabels.igst, "40%", true)}
                      {th(m.ui["Total tax"], "20%", true)}
                    </View>
                    {m.taxSummary.map((t) => (
                      <View key={t.rate} style={s.row}>
                        <Cell s={s} w="16%">{t.rate}</Cell>
                        <Cell s={s} w="24%" right>{t.taxable}</Cell>
                        {m.split && <Cell s={s} w="20%" right>{t.cgst}</Cell>}
                        {m.split && <Cell s={s} w="20%" right>{t.sgst}</Cell>}
                        {!m.split && <Cell s={s} w="40%" right>{t.igst}</Cell>}
                        <Cell s={s} w="20%" right>{t.total}</Cell>
                      </View>
                    ))}
                  </View>
                )}
              </View>
              <View style={s.totals}>
                {m.totals.map((t) => (
                  <View key={t.k} style={[s.totalRow, t.bold ? s.grand : {}]}>
                    <Text style={t.bold ? s.grandText : {}}>{t.k}</Text>
                    <Text style={t.bold ? s.grandText : {}}>{t.v}</Text>
                  </View>
                ))}
              </View>
            </View>
          </>
        ) : (
          m.receipt && (
            <View style={[s.box, { flex: 0 }]}>
              <View style={s.totalRow}>
                <Text style={s.bold}>{m.ui.Amount}</Text>
                <Text style={s.bold}>
                  {m.currency} {m.receipt.amount}
                </Text>
              </View>
              {m.receipt.mode && <Text style={s.small}>{m.ui.Mode}: {m.receipt.mode}</Text>}
              {m.receipt.ref && <Text style={s.small}>{m.ui.Reference}: {m.receipt.ref}</Text>}
              <Text style={[s.bold, { marginTop: 6 }]}>{m.words}</Text>
              {m.wordsAr && <Text style={[s.bold, s.ar]}>{m.wordsAr}</Text>}
              {m.receipt.settles.length > 0 && (
                <View style={{ marginTop: 8 }}>
                  <Text style={s.boxHead}>{m.ui["Against bills"]}</Text>
                  {m.receipt.settles.map((x) => (
                    <View key={x.no} style={s.totalRow}>
                      <Text>
                        {x.no} · {x.date}
                      </Text>
                      <Text>{x.amount}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )
        )}

        <View style={[s.twoCol, { marginTop: 12 }]} wrap={false}>
          {m.bank.length > 0 && (
            <View style={s.box}>
              <Text style={s.boxHead}>{m.ui["Bank details"]}</Text>
              {m.bank.map((b) => (
                <View key={b.k} style={s.metaRow}>
                  <Text style={s.metaK}>{b.k}</Text>
                  <Text>{b.v}</Text>
                </View>
              ))}
            </View>
          )}
          {m.qr && (
            <View style={[s.box, { alignItems: "center", flex: 0, minWidth: 110 }]}>
              {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt */}
              <Image src={m.qr.src} style={s.qr} />
              <Text style={[s.small, { marginTop: 2 }]}>{m.qr.caption}</Text>
            </View>
          )}
          <View style={[s.box, { justifyContent: "flex-end", alignItems: "flex-end", minHeight: 70 }]}>
            <Text style={s.small}>For {m.seller.name}</Text>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt */}
            {m.signature ? <Image src={m.signature} style={s.sign} /> : <View style={{ height: 26 }} />}
            <Text style={s.small}>{m.ui["Authorised signatory"]}</Text>
          </View>
        </View>

        {(m.terms || m.notes) && (
          <View wrap={false}>
            {m.notes && (
              <>
                <Text style={s.boxHead}>{m.ui.Notes}</Text>
                <Text style={s.small}>{m.notes}</Text>
              </>
            )}
            {m.terms && (
              <>
                <Text style={[s.boxHead, { marginTop: 5 }]}>{m.ui["Terms and conditions"]}</Text>
                <Text style={s.small}>{m.terms}</Text>
              </>
            )}
          </View>
        )}

        <View style={s.footer} fixed>
          <Text>{m.seller.name}</Text>
          <Text render={({ pageNumber, totalPages }) => `${m.ui.Page} ${pageNumber} ${m.ui.of} ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

// ─── Thermal receipt (58 mm / 80 mm) ─────────────────────────────────────────

const MM = 72 / 25.4;

function Receipt({ m }: { m: InvoiceModel }) {
  const mm = m.paper === "T58" ? 58 : 80;
  const wide = mm === 80;
  const fs = wide ? 8.5 : 7.5;
  const s = StyleSheet.create({
    page: { padding: 8, fontFamily: FAMILY, fontSize: fs, color: "#000000" },
    center: { textAlign: "center" },
    name: { fontSize: fs + 3, fontWeight: 700, textAlign: "center" },
    bold: { fontWeight: 700 },
    row: { flexDirection: "row", justifyContent: "space-between" },
    rule: { borderBottomWidth: 0.7, borderBottomStyle: "dashed", borderBottomColor: "#000000", marginVertical: 4 },
    item: { marginBottom: 3 },
    logo: { maxHeight: 40, maxWidth: (mm - 4) * MM * 0.7, objectFit: "contain", alignSelf: "center", marginBottom: 3 },
    qr: { width: wide ? 90 : 70, height: wide ? 90 : 70, alignSelf: "center", marginTop: 4 },
  });
  const height = 150 + m.lines.length * (wide ? 30 : 38) + m.totals.length * 13 + m.meta.length * 11 + (m.qr ? 110 : 0) + (m.terms ? 50 : 0) + m.seller.lines.length * 11 + (m.taxSummary.length ? 40 + m.taxSummary.length * 12 : 0) + (m.words.length / (wide ? 40 : 28)) * 11;

  return (
    <Document title={m.title} author={m.seller.name}>
      <Page size={[mm * MM, Math.max(height, 200)]} style={s.page}>
        {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt */}
        {m.logo && <Image src={m.logo} style={s.logo} />}
        <Text style={s.name}>{m.seller.name}</Text>
        {m.seller.nameAr && <Text style={s.name}>{m.seller.nameAr}</Text>}
        {m.seller.lines.map((l, i) => (
          <Text key={i} style={s.center}>
            {l}
          </Text>
        ))}
        {m.seller.taxId && (
          <Text style={[s.center, s.bold]}>
            {m.seller.taxIdLabel}: {m.seller.taxId}
          </Text>
        )}
        <View style={s.rule} />
        <Text style={[s.center, s.bold, { fontSize: fs + 1.5 }]}>{m.title}</Text>
        {m.meta.map((r) => (
          <View key={r.k} style={s.row}>
            <Text>{r.k}</Text>
            <Text style={s.bold}>{r.v}</Text>
          </View>
        ))}
        {m.party.name && (
          <Text style={{ marginTop: 3 }}>
            {m.party.heading}: <Text style={s.bold}>{m.party.name}</Text>
            {m.party.taxId ? `  ${m.party.taxIdLabel}: ${m.party.taxId}` : ""}
          </Text>
        )}
        <View style={s.rule} />

        {m.kind === "invoice" ? (
          m.lines.map((l) => (
            <View key={l.no} style={s.item} wrap={false}>
              <Text style={s.bold}>
                {l.no}. {l.desc}
              </Text>
              {l.descAr && <Text style={{ textAlign: "right" }}>{l.descAr}</Text>}
              <View style={s.row}>
                <Text>
                  {l.qty} × {l.rate}
                  {l.taxRate ? `  (${l.taxRate})` : ""}
                </Text>
                <Text style={s.bold}>{l.total}</Text>
              </View>
            </View>
          ))
        ) : (
          m.receipt && (
            <View>
              <View style={s.row}>
                <Text style={s.bold}>{m.ui.Amount}</Text>
                <Text style={s.bold}>
                  {m.currency} {m.receipt.amount}
                </Text>
              </View>
              {m.receipt.mode && <Text>{m.ui.Mode}: {m.receipt.mode}</Text>}
              {m.receipt.ref && <Text>{m.ui.Reference}: {m.receipt.ref}</Text>}
              {m.receipt.settles.map((x) => (
                <View key={x.no} style={s.row}>
                  <Text>{x.no}</Text>
                  <Text>{x.amount}</Text>
                </View>
              ))}
            </View>
          )
        )}
        <View style={s.rule} />

        {m.totals.map((t) => (
          <View key={t.k} style={s.row}>
            <Text style={t.bold ? [s.bold, { fontSize: fs + 1.5 }] : {}}>{t.k}</Text>
            <Text style={t.bold ? [s.bold, { fontSize: fs + 1.5 }] : {}}>{t.v}</Text>
          </View>
        ))}
        <Text style={{ marginTop: 3, fontSize: fs - 0.5 }}>{m.words}</Text>
        {m.wordsAr && <Text style={{ fontSize: fs - 0.5, textAlign: "right" }}>{m.wordsAr}</Text>}
        {m.taxSummary.length > 0 && (
          <View style={{ marginTop: 3 }}>
            <View style={s.rule} />
            {m.taxSummary.map((t) => (
              <View key={t.rate} style={s.row}>
                <Text>
                  {t.rate} on {t.taxable}
                </Text>
                <Text>{t.total}</Text>
              </View>
            ))}
          </View>
        )}
        {m.qr && (
          <>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt */}
            <Image src={m.qr.src} style={s.qr} />
            <Text style={[s.center, { fontSize: fs - 1 }]}>{m.qr.caption}</Text>
          </>
        )}
        {m.terms && (
          <>
            <View style={s.rule} />
            <Text style={{ fontSize: fs - 1 }}>{m.terms}</Text>
          </>
        )}
        <Text style={[s.center, { marginTop: 5 }]}>{m.ui["Thank you!"]}</Text>
      </Page>
    </Document>
  );
}

export async function renderInvoicePdf(model: InvoiceModel): Promise<Buffer> {
  return renderToBuffer(model.paper === "T80" || model.paper === "T58" ? <Receipt m={model} /> : <Sheet m={model} />);
}
