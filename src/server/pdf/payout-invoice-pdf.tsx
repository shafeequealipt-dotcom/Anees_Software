import { Document, Image, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";
import { formatDate } from "@/lib/dates";
import type { PayoutInvoiceModel } from "../partners";
import "./fonts";
import { PAYOUT_BODY, PAYOUT_DISPLAY, PAYOUT_MONO } from "./fonts";

/*
 * The partner payout invoice, in Orpheus's own look: cream paper, a hairline frame with gold
 * corner brackets, serif headings, monospaced labels and a shaded total. A4 only. (Sizes are the
 * old generator's CSS pixels × 0.75, since a PDF counts in points.)
 */

const paper = "#FAF6EC";
const paperDeep = "#F2EBDA";
const ink = "#2B2118";
const grey = "#6B5F53";
const gold = "#9A7B2D";
const goldDeep = "#7F651F";
const rule = "#C9B37E";
const hair = "#E0D4B4";

const s = StyleSheet.create({
  page: { backgroundColor: paper, color: ink, fontFamily: PAYOUT_BODY, fontSize: 9.75, lineHeight: 1.5, paddingTop: 60, paddingBottom: 45, paddingHorizontal: 54 },
  frame: { position: "absolute", top: 23, left: 23, right: 23, bottom: 23, borderWidth: 0.75, borderColor: hair },
  cTL: { position: "absolute", top: -1, left: -1, width: 10, height: 10, borderTopWidth: 1.1, borderLeftWidth: 1.1, borderColor: gold },
  cTR: { position: "absolute", top: -1, right: -1, width: 10, height: 10, borderTopWidth: 1.1, borderRightWidth: 1.1, borderColor: gold },
  cBL: { position: "absolute", bottom: -1, left: -1, width: 10, height: 10, borderBottomWidth: 1.1, borderLeftWidth: 1.1, borderColor: gold },
  cBR: { position: "absolute", bottom: -1, right: -1, width: 10, height: 10, borderBottomWidth: 1.1, borderRightWidth: 1.1, borderColor: gold },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  brand: { flexDirection: "row", flex: 1, paddingRight: 18 },
  logo: { width: 36, height: 36, marginRight: 11, objectFit: "contain" },
  brandName: { fontFamily: PAYOUT_DISPLAY, fontWeight: 600, fontSize: 16.5, lineHeight: 1.15, letterSpacing: 2.2, textTransform: "uppercase", marginTop: 1, marginBottom: 6 },
  brandLine: { fontSize: 8.6, color: grey, lineHeight: 1.7 },
  brandIds: { fontFamily: PAYOUT_MONO, fontSize: 7.1, letterSpacing: 0.3, color: ink, marginTop: 1 },
  meta: { alignItems: "flex-end", minWidth: 147 },
  docTitle: { fontFamily: PAYOUT_MONO, fontSize: 8.6, letterSpacing: 2.7, textTransform: "uppercase", color: goldDeep, marginTop: 4, marginBottom: 10 },
  metaRow: { flexDirection: "row", marginBottom: 2 },
  metaK: { fontFamily: PAYOUT_MONO, fontSize: 6.8, letterSpacing: 1.2, textTransform: "uppercase", color: grey, marginRight: 10, marginTop: 2 },
  metaV: { fontSize: 9.4, fontWeight: 500, textAlign: "right" },
  rule: { height: 1.1, backgroundColor: gold, marginTop: 14, marginBottom: 13 },
  hair: { height: 0.75, backgroundColor: hair, marginTop: 11, marginBottom: 12 },
  secLabel: { fontFamily: PAYOUT_MONO, fontSize: 7.1, letterSpacing: 2, textTransform: "uppercase", color: goldDeep, marginBottom: 5 },
  payee: { fontFamily: PAYOUT_DISPLAY, fontWeight: 600, fontSize: 15, lineHeight: 1.25, marginBottom: 4 },
  payeeLine: { fontSize: 9, color: grey, lineHeight: 1.7 },
  th: { fontFamily: PAYOUT_MONO, fontSize: 7.1, letterSpacing: 1.65, textTransform: "uppercase", color: goldDeep },
  thead: { flexDirection: "row", paddingBottom: 7, borderBottomWidth: 0.75, borderBottomColor: rule },
  row: { flexDirection: "row", paddingVertical: 10, borderBottomWidth: 0.75, borderBottomColor: hair },
  cDesc: { flex: 1, paddingRight: 14 },
  cBasis: { width: 135, paddingRight: 14 },
  cAmt: { width: 98, textAlign: "right" },
  desc: { fontSize: 10.1, fontWeight: 500 },
  sub: { fontSize: 8.6, color: grey, marginTop: 2 },
  basis: { fontSize: 9, color: grey },
  amt: { fontSize: 10.5, fontWeight: 500 },
  totals: { flexDirection: "row", justifyContent: "flex-end", marginTop: 14 },
  box: { width: 252, backgroundColor: paperDeep, borderTopWidth: 1.1, borderTopColor: gold, paddingTop: 11, paddingBottom: 10, paddingHorizontal: 13 },
  totalLine: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  totalK: { fontFamily: PAYOUT_MONO, fontSize: 7.5, letterSpacing: 2, textTransform: "uppercase" },
  totalV: { fontSize: 21, lineHeight: 1.1, fontWeight: 600, color: goldDeep },
  words: { textAlign: "right", fontSize: 8.6, color: grey, marginTop: 7 },
  foot: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", paddingTop: 21 },
  notes: { width: "58%", fontSize: 8.6, color: grey, lineHeight: 1.7 },
  sign: { width: 160, alignItems: "center" },
  sigBox: { height: 66, width: 160, justifyContent: "flex-end", alignItems: "center" },
  sigImg: { maxHeight: 66, maxWidth: 135, objectFit: "contain", marginBottom: -4 },
  signLine: { width: 160, borderTopWidth: 0.75, borderTopColor: rule, marginBottom: 5 },
  signWho: { fontSize: 9.4, fontWeight: 500, textAlign: "center" },
  signRole: { fontFamily: PAYOUT_MONO, fontSize: 6.8, letterSpacing: 1.5, textTransform: "uppercase", color: grey, marginTop: 3 },
  colophon: { marginTop: 14, paddingTop: 8, borderTopWidth: 0.75, borderTopColor: hair, fontFamily: PAYOUT_MONO, fontSize: 6.4, letterSpacing: 1.3, textTransform: "uppercase", color: grey, textAlign: "center" },
});

/** ₹ with Indian grouping and no paise: ₹1,25,000. Payout amounts are whole rupees. */
const inr = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

function Invoice({ m }: { m: PayoutInvoiceModel }) {
  const c = m.company;
  const signer = m.signer.name ? `${m.signer.name}, for ${m.signer.companyName}` : `For ${m.signer.companyName}`;
  const meta: [string, string][] = [
    ["No.", m.invoiceNo],
    ["Date", formatDate(m.date)],
  ];
  if (m.period) meta.push(["Period", m.period]);
  return (
    <Document title={`Invoice ${m.invoiceNo} · ${m.payee.name}`} author={c.name}>
      <Page size="A4" style={s.page}>
        <View style={s.frame} fixed>
          <View style={s.cTL} />
          <View style={s.cTR} />
          <View style={s.cBL} />
          <View style={s.cBR} />
        </View>

        <View style={s.head}>
          <View style={s.brand}>
            {m.logo && <Image src={m.logo} style={s.logo} />}
            <View style={{ flex: 1 }}>
              <Text style={s.brandName}>{c.name}</Text>
              {c.addressLines.map((l, i) => (
                <Text key={i} style={s.brandLine}>
                  {l}
                </Text>
              ))}
              {c.contactLine ? <Text style={s.brandLine}>{c.contactLine}</Text> : null}
              {c.idLine ? <Text style={s.brandIds}>{c.idLine}</Text> : null}
            </View>
          </View>
          <View style={s.meta}>
            <Text style={s.docTitle}>Payout Invoice</Text>
            {meta.map(([k, v]) => (
              <View key={k} style={s.metaRow}>
                <Text style={s.metaK}>{k}</Text>
                <Text style={s.metaV}>{v}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={s.rule} />

        <Text style={s.secLabel}>Payable to</Text>
        <Text style={s.payee}>{m.payee.name}</Text>
        {m.payee.lines.map((l, i) => (
          <Text key={i} style={s.payeeLine}>
            {l}
          </Text>
        ))}

        <View style={s.hair} />

        <View style={s.thead}>
          <Text style={[s.th, s.cDesc]}>Description</Text>
          <Text style={[s.th, s.cBasis]}>Basis</Text>
          <Text style={[s.th, s.cAmt]}>Amount</Text>
        </View>
        {m.items.map((it, i) => (
          <View key={i} style={s.row} wrap={false}>
            <View style={s.cDesc}>
              <Text style={s.desc}>{it.description}</Text>
              {it.sub ? <Text style={s.sub}>{it.sub}</Text> : null}
            </View>
            <Text style={[s.basis, s.cBasis]}>{it.basis}</Text>
            <Text style={[s.amt, s.cAmt]}>{inr(it.amountPaise)}</Text>
          </View>
        ))}

        <View style={s.totals} wrap={false}>
          <View style={s.box}>
            <View style={s.totalLine}>
              <Text style={s.totalK}>Total payable</Text>
              <Text style={s.totalV}>{inr(m.totalPaise)}</Text>
            </View>
            <Text style={s.words}>{m.words}</Text>
          </View>
        </View>

        <View style={{ flexGrow: 1 }} />

        <View style={s.foot} wrap={false}>
          <Text style={s.notes}>{m.notes}</Text>
          <View style={s.sign}>
            <View style={s.sigBox}>{m.signature && <Image src={m.signature} style={s.sigImg} />}</View>
            <View style={s.signLine} />
            <Text style={s.signWho}>{signer}</Text>
            <Text style={s.signRole}>{m.signer.role}</Text>
          </View>
        </View>

        <Text style={s.colophon}>
          {c.name}
          {c.website ? ` · ${c.website}` : ""} · This is a computer-generated payout statement
        </Text>
      </Page>
    </Document>
  );
}

export async function renderPayoutInvoicePdf(model: PayoutInvoiceModel): Promise<Buffer> {
  return renderToBuffer(<Invoice m={model} />);
}
