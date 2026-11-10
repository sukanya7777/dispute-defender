// Builds the evidence packet (PDF) that is attached to provide-evidence.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { Dispute, OrderRecord } from "./types";

// Standard PDF fonts only cover WinAnsi; swap anything else for a safe glyph.
function clean(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/•/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, "");
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of clean(text).split("\n")) {
    if (!para.trim()) {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > maxWidth && line) {
        out.push(line);
        line = word;
      } else line = next;
    }
    if (line) out.push(line);
  }
  return out;
}

export async function buildEvidencePdf(opts: {
  storeName: string;
  dispute: Dispute;
  order?: OrderRecord;
  letter: string;
  evidenceType: string;
}): Promise<Uint8Array> {
  const { storeName, dispute, order, letter, evidenceType } = opts;
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdf.embedFont(StandardFonts.Courier);
  pdf.setTitle(`Seller evidence for PayPal dispute ${dispute.dispute_id}`);
  pdf.setAuthor(storeName);

  const W = 595.28;
  const H = 841.89;
  const M = 50;
  const ink = rgb(0.09, 0.11, 0.16);
  const muted = rgb(0.38, 0.42, 0.5);
  const accent = rgb(0.05, 0.32, 0.75);

  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - M;
  const ensure = (need: number) => {
    if (y - need < M + 20) {
      page = pdf.addPage([W, H]);
      y = H - M;
    }
  };
  const text = (s: string, o: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; x?: number } = {}) => {
    const size = o.size ?? 10;
    ensure(size + 4);
    page.drawText(clean(s), { x: o.x ?? M, y: y - size, size, font: o.font ?? regular, color: o.color ?? ink });
    y -= size + 4;
  };
  const para = (s: string, o: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb> } = {}) => {
    for (const line of wrap(s, o.font ?? regular, o.size ?? 10, W - 2 * M)) {
      if (line === "") y -= 6;
      else text(line, o);
    }
  };
  const heading = (s: string) => {
    y -= 10;
    ensure(30);
    text(s.toUpperCase(), { font: bold, size: 9, color: accent });
    page.drawLine({ start: { x: M, y: y + 1 }, end: { x: W - M, y: y + 1 }, thickness: 0.6, color: rgb(0.82, 0.85, 0.9) });
    y -= 6;
  };
  const row = (k: string, v: string) => {
    const lines = wrap(v, regular, 10, W - 2 * M - 150);
    ensure(14 * lines.length);
    page.drawText(clean(k), { x: M, y: y - 10, size: 10, font: regular, color: muted });
    for (const l of lines) {
      page.drawText(l, { x: M + 150, y: y - 10, size: 10, font: regular, color: ink });
      y -= 14;
    }
  };

  text(storeName, { font: bold, size: 18 });
  text("Seller evidence submission", { size: 11, color: muted });
  y -= 6;

  const tx = dispute.disputed_transactions?.[0];
  heading("Dispute");
  row("PayPal dispute ID", dispute.dispute_id);
  row("Reason", dispute.reason.replaceAll("_", " ").toLowerCase());
  row("Disputed amount", `${dispute.dispute_amount.value} ${dispute.dispute_amount.currency_code}`);
  if (tx?.seller_transaction_id) row("Transaction ID", tx.seller_transaction_id);
  if (tx?.buyer?.name) row("Buyer", tx.buyer.name);
  row("Evidence type", evidenceType.replaceAll("_", " ").toLowerCase());
  row("Prepared", new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC");

  heading("Statement");
  para(letter);

  if (order) {
    heading("Order record");
    row("Order ID", order.orderId);
    row("Item", `${order.productName} (${order.sku})`);
    row("Listing", order.listing.description);
    row("Paid", `${order.amount.value} ${order.amount.currency_code} on ${order.createdAt.replace("T", " ").slice(0, 16)} UTC`);
    if (order.shippingAddress) row("Ship-to address", order.shippingAddress);

    if (order.fulfillment.type === "SHIPMENT") {
      const f = order.fulfillment;
      heading("Shipment");
      row("Carrier / service", `${f.carrier}, ${f.service}`);
      row("Tracking number", f.trackingNumber);
      row("Ship-to = PayPal address", f.shipToMatchesPayPalAddress ? "Yes" : "No");
      if (f.signedBy) row("Signed for by", f.signedBy);
      row("Packed weight", `${f.packageWeightGrams} g`);
      y -= 4;
      for (const e of f.events) {
        const line = `${e.time.replace("T", " ").slice(0, 16)}  ${e.status.padEnd(17)} ${e.location}`;
        text(line, { font: mono, size: 8.5 });
        if (e.detail) for (const l of wrap(e.detail, regular, 8.5, W - 2 * M - 110)) text(l, { size: 8.5, color: muted, x: M + 110 });
      }
    } else {
      const f = order.fulfillment;
      heading("Digital delivery and usage log");
      row("License key", f.licenseKey);
      y -= 4;
      for (const e of f.accessLogs) {
        text(`${e.time.replace("T", " ").slice(0, 16)}  ${e.action.padEnd(18)} ${e.ip.padEnd(15)} ${e.device}`, { font: mono, size: 8.5 });
        if (e.detail) text(e.detail, { size: 8.5, color: muted, x: M + 110 });
      }
    }

    if (order.supportThread.length) {
      heading("Customer correspondence");
      for (const m of order.supportThread) {
        para(`${m.time.replace("T", " ").slice(0, 16)}  ${m.from === "store" ? storeName : "Customer"}: ${m.text}`, { size: 9 });
      }
    }
  }

  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    p.drawText(clean(`${storeName} - dispute ${dispute.dispute_id} - page ${i + 1} of ${pages.length}`), { x: M, y: 28, size: 8, font: regular, color: muted });
  });
  return pdf.save();
}
