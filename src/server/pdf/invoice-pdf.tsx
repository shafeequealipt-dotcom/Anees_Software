import { Document, Image, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { InvoiceModel } from "../invoice";

const ink = "#1a2230";
const muted = "#5b6675";
const line = "#cfd6df";
const accent = "#1f4e79";

const s = StyleSheet.create({
  page: { paddingTop: 28, paddingBottom: 46, paddingHorizontal: 30, fontFamily: "Helvetica", fontSize: 9, color: ink },
  head: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 1.5, borderBottomColor: accent, paddingBottom: 8, marginBottom: 10 },
  sellerName: { fontSize: 15, fontFamily: "Helvetica-Bold", color: accent },
  small: { fontSize: 8.5, color: muted, lineHeight: 1.35 },
  title: { fontSize: 14, fontFamily: "Helvetica-Bold", textAlign: "right", color: accent },
  cancelled: { color: "#b3261e" },
  twoCol: { flexDirection: "row", gap: 12, marginBottom: 10 },
  box: { flex: 1, borderWidth: 0.75, borderColor: line, borderRadius: 3, padding: 7 },
  boxHead: { fontSize: 7.5, color: muted, textTransform: "uppercase", marginBottom: 3, fontFamily: "Helvetica-Bold" },
  bold: { fontFamily: "Helvetica-Bold" },
  metaRow: { flexDirection: "row", marginBottom: 1.5 },
  metaK: { width: 88, color: muted },
  thead: { flexDirection: "row", backgroundColor: "#eef2f7", borderTopWidth: 0.75, borderBottomWidth: 0.75, borderColor: line },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: line },
  cell: { paddingVertical: 4, paddingHorizontal: 3 },
  th: { fontFamily: "Helvetica-Bold", fontSize: 8 },
  right: { textAlign: "right" },
  totalsWrap: { flexDirection: "row", justifyContent: "space-between", marginTop: 8, gap: 14 },
  totals: { width: 210 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  grand: { borderTopWidth: 1, borderBottomWidth: 1, borderColor: ink, paddingVertical: 4, marginVertical: 2 },
  footer: { position: "absolute", bottom: 20, left: 30, right: 30, flexDirection: "row", justifyContent: "space-between", fontSize: 7.5, color: muted },
  qr: { width: 82, height: 82 },
});

function Cell({ w, children, right, bold }: { w: number | string; children?: React.ReactNode; right?: boolean; bold?: boolean }) {
  return (
    <View style={[s.cell, { width: typeof w === "number" ? `${w}%` : w }]}>
      <Text style={[right ? s.right : {}, bold ? s.bold : {}]}>{children}</Text>
    </View>
  );
}

function Invoice({ m }: { m: InvoiceModel }) {
  const c = m.columns;
  // column widths (percent) — description takes what's left
  const w = { no: 4, hsn: c.hsn ? 9 : 0, qty: 10, rate: 11, disc: c.discount ? 9 : 0, taxable: 12, taxrate: c.tax ? 7 : 0, tax: c.tax ? 10 : 0, total: 12 };
  const desc = 100 - Object.values(w).reduce((a, b) => a + b, 0);

  return (
    <Document title={m.title} author={m.seller.name}>
      <Page size={m.paper} style={s.page} wrap>
        <View style={s.head}>
          <View style={{ maxWidth: "62%" }}>
            <Text style={s.sellerName}>{m.seller.name}</Text>
            {m.seller.lines.map((l, i) => (
              <Text key={i} style={s.small}>
                {l}
              </Text>
            ))}
            {m.seller.taxId && (
              <Text style={[s.small, s.bold]}>
                {m.seller.taxIdLabel}: {m.seller.taxId}
              </Text>
            )}
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={[s.title, m.cancelled ? s.cancelled : {}]}>{m.title}</Text>
            <Text style={s.small}>Amounts in {m.currency}</Text>
          </View>
        </View>

        <View style={s.twoCol}>
          {(m.party.name || m.party.lines.length > 0) && (
            <View style={s.box}>
              <Text style={s.boxHead}>{m.party.heading}</Text>
              <Text style={s.bold}>{m.party.name}</Text>
              {m.party.lines.map((l, i) => (
                <Text key={i} style={s.small}>
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
              <Cell w={w.no}><Text style={s.th}>#</Text></Cell>
              <Cell w={desc}><Text style={s.th}>Item</Text></Cell>
              {c.hsn && <Cell w={w.hsn}><Text style={s.th}>HSN</Text></Cell>}
              <Cell w={w.qty} right><Text style={s.th}>Qty</Text></Cell>
              <Cell w={w.rate} right><Text style={s.th}>Rate</Text></Cell>
              {c.discount && <Cell w={w.disc} right><Text style={s.th}>Discount</Text></Cell>}
              <Cell w={w.taxable} right><Text style={s.th}>Taxable</Text></Cell>
              {c.tax && <Cell w={w.taxrate} right><Text style={s.th}>Tax %</Text></Cell>}
              {c.tax && <Cell w={w.tax} right><Text style={s.th}>Tax</Text></Cell>}
              <Cell w={w.total} right><Text style={s.th}>Amount</Text></Cell>
            </View>
            {m.lines.map((l) => (
              <View key={l.no} style={s.row} wrap={false}>
                <Cell w={w.no}>{l.no}</Cell>
                <Cell w={desc}>{l.desc}</Cell>
                {c.hsn && <Cell w={w.hsn}>{l.hsn}</Cell>}
                <Cell w={w.qty} right>{l.qty}</Cell>
                <Cell w={w.rate} right>{l.rate}</Cell>
                {c.discount && <Cell w={w.disc} right>{l.discount}</Cell>}
                <Cell w={w.taxable} right>{l.taxable}</Cell>
                {c.tax && <Cell w={w.taxrate} right>{l.taxRate}</Cell>}
                {c.tax && <Cell w={w.tax} right>{l.tax}</Cell>}
                <Cell w={w.total} right bold>{l.total}</Cell>
              </View>
            ))}

            <View style={s.totalsWrap} wrap={false}>
              <View style={{ flex: 1 }}>
                <Text style={s.boxHead}>Amount in words</Text>
                <Text style={s.bold}>{m.words}</Text>
                {m.taxSummary.length > 0 && (
                  <View style={{ marginTop: 8 }}>
                    <View style={s.thead}>
                      <Cell w="16%"><Text style={s.th}>Rate</Text></Cell>
                      <Cell w="24%" right><Text style={s.th}>Taxable</Text></Cell>
                      {m.split && <Cell w="20%" right><Text style={s.th}>{m.taxLabels.cgst}</Text></Cell>}
                      {m.split && <Cell w="20%" right><Text style={s.th}>{m.taxLabels.sgst}</Text></Cell>}
                      {!m.split && <Cell w={m.split ? "0%" : "40%"} right><Text style={s.th}>{m.taxLabels.igst}</Text></Cell>}
                      <Cell w="20%" right><Text style={s.th}>Total tax</Text></Cell>
                    </View>
                    {m.taxSummary.map((t) => (
                      <View key={t.rate} style={s.row}>
                        <Cell w="16%">{t.rate}</Cell>
                        <Cell w="24%" right>{t.taxable}</Cell>
                        {m.split && <Cell w="20%" right>{t.cgst}</Cell>}
                        {m.split && <Cell w="20%" right>{t.sgst}</Cell>}
                        {!m.split && <Cell w="40%" right>{t.igst}</Cell>}
                        <Cell w="20%" right>{t.total}</Cell>
                      </View>
                    ))}
                  </View>
                )}
              </View>
              <View style={s.totals}>
                {m.totals.map((t) => (
                  <View key={t.k} style={[s.totalRow, t.bold ? s.grand : {}]}>
                    <Text style={t.bold ? s.bold : {}}>{t.k}</Text>
                    <Text style={t.bold ? s.bold : {}}>{t.v}</Text>
                  </View>
                ))}
              </View>
            </View>
          </>
        ) : (
          m.receipt && (
            <View style={[s.box, { flex: 0 }]}>
              <View style={s.totalRow}>
                <Text style={s.bold}>Amount</Text>
                <Text style={s.bold}>
                  {m.currency} {m.receipt.amount}
                </Text>
              </View>
              {m.receipt.mode && <Text style={s.small}>Mode: {m.receipt.mode}</Text>}
              {m.receipt.ref && <Text style={s.small}>Reference: {m.receipt.ref}</Text>}
              <Text style={[s.bold, { marginTop: 6 }]}>{m.words}</Text>
              {m.receipt.settles.length > 0 && (
                <View style={{ marginTop: 8 }}>
                  <Text style={s.boxHead}>Against bills</Text>
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
              <Text style={s.boxHead}>Bank details</Text>
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
            <Text style={[s.small, { marginTop: 26 }]}>Authorised signatory</Text>
          </View>
        </View>

        {(m.terms || m.notes) && (
          <View wrap={false}>
            {m.notes && (
              <>
                <Text style={s.boxHead}>Notes</Text>
                <Text style={s.small}>{m.notes}</Text>
              </>
            )}
            {m.terms && (
              <>
                <Text style={[s.boxHead, { marginTop: 5 }]}>Terms and conditions</Text>
                <Text style={s.small}>{m.terms}</Text>
              </>
            )}
          </View>
        )}

        <View style={s.footer} fixed>
          <Text>{m.seller.name}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderInvoicePdf(model: InvoiceModel): Promise<Buffer> {
  return renderToBuffer(<Invoice m={model} />);
}
