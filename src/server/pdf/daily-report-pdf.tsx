import { Document, Image, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { DailyReportModel } from "../daily-report";
import { FAMILY, MM } from "./fonts";

const ink = "#1a2230";
const muted = "#5b6675";
const line = "#cfd6df";
const accent = "#1f4e79";

const sheetStyles = StyleSheet.create({
  page: { padding: 30, fontFamily: FAMILY, fontSize: 9.5, color: ink },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", borderBottomWidth: 1.5, borderBottomColor: accent, paddingBottom: 10, marginBottom: 12 },
  logo: { maxHeight: 44, maxWidth: 120, objectFit: "contain", marginBottom: 6 },
  companyName: { fontSize: 14, fontWeight: 700, color: accent },
  title: { fontSize: 13, fontWeight: 700, textAlign: "right", color: accent },
  sub: { fontSize: 9.5, textAlign: "right", color: muted, marginTop: 2 },
  sectionTitle: { fontSize: 9, fontWeight: 700, color: accent, textTransform: "uppercase", marginBottom: 4, marginTop: 14 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2.5, borderBottomWidth: 0.5, borderBottomColor: line },
  rowBold: { fontWeight: 700, fontSize: 10.5 },
  table: { marginTop: 4 },
  thead: { flexDirection: "row", backgroundColor: "#eef2f7", borderTopWidth: 0.75, borderBottomWidth: 0.75, borderColor: line, paddingVertical: 3 },
  th: { fontSize: 8, fontWeight: 700, paddingHorizontal: 4 },
  trow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: line, paddingVertical: 3 },
  td: { fontSize: 8.5, paddingHorizontal: 4 },
  right: { textAlign: "right" },
  footer: { position: "absolute", bottom: 20, left: 30, right: 30, fontSize: 8, color: muted, textAlign: "center" },
});

function A4({ m }: { m: DailyReportModel }) {
  return (
    <Document title={m.title} author={m.companyName}>
      <Page size="A4" style={sheetStyles.page}>
        <View style={sheetStyles.head}>
          <View>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt */}
            {m.logo && <Image src={m.logo} style={sheetStyles.logo} />}
            <Text style={sheetStyles.companyName}>{m.companyName}</Text>
            {m.companyNameAr && <Text style={[sheetStyles.companyName, { textAlign: "right" }]}>{m.companyNameAr}</Text>}
          </View>
          <View>
            <Text style={sheetStyles.title}>{m.title}</Text>
            <Text style={sheetStyles.sub}>{m.locationLabel}</Text>
            <Text style={sheetStyles.sub}>{m.dateLabel}</Text>
          </View>
        </View>

        <Text style={sheetStyles.sectionTitle}>Summary</Text>
        {m.summary.map((s, i) => (
          <View key={i} style={sheetStyles.row}>
            <Text style={s.bold ? sheetStyles.rowBold : undefined}>{s.k}</Text>
            <Text style={s.bold ? sheetStyles.rowBold : undefined}>{m.currency} {s.v}</Text>
          </View>
        ))}

        {m.byPaymentMode.length > 0 && (
          <>
            <Text style={sheetStyles.sectionTitle}>{m.ui.Mode}</Text>
            <View style={sheetStyles.table}>
              <View style={sheetStyles.thead}>
                <Text style={[sheetStyles.th, { width: "60%" }]}>{m.ui.Mode}</Text>
                <Text style={[sheetStyles.th, sheetStyles.right, { width: "40%" }]}>{m.ui.Amount}</Text>
              </View>
              {m.byPaymentMode.map((r, i) => (
                <View key={i} style={sheetStyles.trow}>
                  <Text style={[sheetStyles.td, { width: "60%" }]}>{r.mode}</Text>
                  <Text style={[sheetStyles.td, sheetStyles.right, { width: "40%" }]}>{m.currency} {r.amount}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {m.topItems.length > 0 && (
          <>
            <Text style={sheetStyles.sectionTitle}>Top items</Text>
            <View style={sheetStyles.table}>
              <View style={sheetStyles.thead}>
                <Text style={[sheetStyles.th, { width: "50%" }]}>{m.ui.Item}</Text>
                <Text style={[sheetStyles.th, sheetStyles.right, { width: "25%" }]}>{m.ui.Qty}</Text>
                <Text style={[sheetStyles.th, sheetStyles.right, { width: "25%" }]}>{m.ui.Amount}</Text>
              </View>
              {m.topItems.map((r, i) => (
                <View key={i} style={sheetStyles.trow}>
                  <Text style={[sheetStyles.td, { width: "50%" }]}>{r.name}</Text>
                  <Text style={[sheetStyles.td, sheetStyles.right, { width: "25%" }]}>{r.qty}</Text>
                  <Text style={[sheetStyles.td, sheetStyles.right, { width: "25%" }]}>{m.currency} {r.amount}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {m.byStaff.length > 0 && (
          <>
            <Text style={sheetStyles.sectionTitle}>Staff</Text>
            <View style={sheetStyles.table}>
              <View style={sheetStyles.thead}>
                <Text style={[sheetStyles.th, { width: "40%" }]}>Staff</Text>
                <Text style={[sheetStyles.th, sheetStyles.right, { width: "15%" }]}>{m.ui.Total}</Text>
                <Text style={[sheetStyles.th, sheetStyles.right, { width: "25%" }]}>Sales</Text>
                <Text style={[sheetStyles.th, sheetStyles.right, { width: "20%" }]}>Returns</Text>
              </View>
              {m.byStaff.map((r, i) => (
                <View key={i} style={sheetStyles.trow}>
                  <Text style={[sheetStyles.td, { width: "40%" }]}>{r.name}</Text>
                  <Text style={[sheetStyles.td, sheetStyles.right, { width: "15%" }]}>{r.bills}</Text>
                  <Text style={[sheetStyles.td, sheetStyles.right, { width: "25%" }]}>{m.currency} {r.sales}</Text>
                  <Text style={[sheetStyles.td, sheetStyles.right, { width: "20%" }]}>{r.returns ? `${m.currency} ${r.returns}` : "—"}</Text>
                </View>
              ))}
            </View>
          </>
        )}
        <Text style={sheetStyles.footer}>{m.ui["Thank you!"]}</Text>
      </Page>
    </Document>
  );
}

function Slip({ m }: { m: DailyReportModel }) {
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
    logo: { maxHeight: 36, maxWidth: (mm - 4) * MM * 0.7, objectFit: "contain", alignSelf: "center", marginBottom: 3 },
  });
  const height = 130 + m.summary.length * 13 + m.byPaymentMode.length * 13;

  return (
    <Document title={m.title} author={m.companyName}>
      <Page size={[mm * MM, Math.max(height, 180)]} style={s.page}>
        {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt */}
        {m.logo && <Image src={m.logo} style={s.logo} />}
        <Text style={s.name}>{m.companyName}</Text>
        {m.companyNameAr && <Text style={s.name}>{m.companyNameAr}</Text>}
        <View style={s.rule} />
        <Text style={[s.center, s.bold, { fontSize: fs + 1.5 }]}>{m.title}</Text>
        <Text style={s.center}>{m.locationLabel}</Text>
        <Text style={s.center}>{m.dateLabel}</Text>
        <View style={s.rule} />
        {m.summary.map((r, i) => (
          <View key={i} style={s.row}>
            <Text style={r.bold ? s.bold : undefined}>{r.k}</Text>
            <Text style={r.bold ? s.bold : undefined}>{m.currency} {r.v}</Text>
          </View>
        ))}
        {m.byPaymentMode.length > 0 && (
          <>
            <View style={s.rule} />
            <Text style={s.bold}>{m.ui.Mode}</Text>
            {m.byPaymentMode.map((r, i) => (
              <View key={i} style={s.row}>
                <Text>{r.mode}</Text>
                <Text>{m.currency} {r.amount}</Text>
              </View>
            ))}
          </>
        )}
        <View style={s.rule} />
        <Text style={[s.center, { marginTop: 5 }]}>{m.ui["Thank you!"]}</Text>
      </Page>
    </Document>
  );
}

export async function renderDailyReportPdf(model: DailyReportModel): Promise<Buffer> {
  return renderToBuffer(model.paper === "A4" ? <A4 m={model} /> : <Slip m={model} />);
}
