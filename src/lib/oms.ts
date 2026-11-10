// A simulated merchant order-management system (OMS) for the demo store.
//
// PayPal knows about the payment; it does not know what happened to the parcel,
// what the listing said, or what the customer wrote to support. A real seller
// keeps that in Shopify / WooCommerce / a spreadsheet. Here it is generated per
// product so each item exercises a different dispute outcome. The fulfilment
// timeline runs on an accelerated clock (minutes instead of days) so a judge
// can buy, dispute and resolve in one sitting.
import { db, save } from "./store";
import type { Money, OrderRecord, TrackingEvent } from "./types";

export interface Product {
  sku: string;
  name: string;
  price: string;
  category: "PHYSICAL_GOODS" | "DIGITAL_GOODS";
  blurb: string;
  description: string;
  emoji: string;
  /** Shown in the store so the demo is honest about what will happen. */
  scenario: string;
}

export const CURRENCY = "USD";

export const CATALOG: Product[] = [
  {
    sku: "KW-HEADPHONES",
    name: "Studio Monitor Headphones",
    price: "129.00",
    category: "PHYSICAL_GOODS",
    emoji: "🎧",
    blurb: "Closed-back, 40 mm drivers, detachable cable.",
    description: "Closed-back studio monitor headphones, black, 40 mm drivers, 3 m detachable cable, new in box.",
    scenario: "Ships tracked and is signed for at the PayPal address. A 'not received' claim here is winnable.",
  },
  {
    sku: "KW-MUG-SET",
    name: "Hand-thrown Mug Set (4)",
    price: "48.00",
    category: "PHYSICAL_GOODS",
    emoji: "☕",
    blurb: "Four stoneware mugs, speckled oat glaze.",
    description: "Set of four hand-thrown stoneware mugs, speckled oat glaze, 350 ml each.",
    scenario: "The carrier scans it as damaged in transit and it never arrives. The honest move is to refund.",
  },
  {
    sku: "KW-COURSE",
    name: "Wheel-Throwing Masterclass",
    price: "59.00",
    category: "DIGITAL_GOODS",
    emoji: "🎬",
    blurb: "12-lesson video course, lifetime access.",
    description: "12-lesson streaming video course with downloadable worksheets. Instant access after payment.",
    scenario: "Digital delivery with access logs showing lessons watched. 'Unauthorised' or 'not received' claims are contestable.",
  },
  {
    sku: "KW-LAMP",
    name: "Wire Desk Lamp",
    price: "74.00",
    category: "PHYSICAL_GOODS",
    emoji: "💡",
    blurb: "Bent-wire frame, brass finish, warm LED.",
    description: "Bent-wire desk lamp, brushed brass finish, includes 2700K LED bulb.",
    scenario: "Delivered, but the warehouse packed the wrong finish. 'Not as described' is the store's fault: settle.",
  },
  {
    sku: "KW-STICKERS",
    name: "Glaze Swatch Sticker Pack",
    price: "8.00",
    category: "PHYSICAL_GOODS",
    emoji: "🏷️",
    blurb: "24 vinyl stickers of our glaze swatches.",
    description: "Pack of 24 vinyl stickers. Ships by untracked letter post.",
    scenario: "Sent by untracked letter post, so there is no proof of delivery and the order is tiny. Not worth a fight.",
  },
];

export function findProduct(sku: string | undefined): Product | undefined {
  return CATALOG.find((p) => p.sku === sku);
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function plus(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

export interface OrderSeed {
  orderId: string;
  captureId: string;
  sku: string;
  createdAt: string;
  amount?: Money;
  buyer?: { name?: string; email?: string; payerId?: string };
  shippingAddress?: string;
  reconstructed?: boolean;
}

export function buildOrderRecord(seed: OrderSeed): OrderRecord | undefined {
  const p = findProduct(seed.sku);
  if (!p) return undefined;
  const h = hash(seed.captureId);
  const t0 = seed.createdAt;
  const tracking = `7${String(h).padStart(10, "0")}${String(h % 97).padStart(2, "0")}`;
  const firstName = (seed.buyer?.name || "the customer").split(" ")[0];
  const origin = "Asheville, NC";
  // "line 1, city, state, zip, country" -> "city, state"
  const dest = seed.shippingAddress?.split(",").slice(-4, -2).join(",").trim() || "destination city";

  const base = {
    orderId: seed.orderId,
    captureId: seed.captureId,
    sku: p.sku,
    productName: p.name,
    category: p.category,
    amount: seed.amount ?? { currency_code: CURRENCY, value: p.price },
    createdAt: t0,
    buyer: seed.buyer ?? {},
    shippingAddress: seed.shippingAddress,
    listing: {
      description: p.description,
      condition: "New",
      url: `https://kilnandwire.example/products/${p.sku.toLowerCase()}`,
    },
    reconstructed: seed.reconstructed,
  };

  const shipped = (events: TrackingEvent[]): TrackingEvent[] => [
    { time: plus(t0, 1), status: "LABEL_CREATED", location: origin },
    { time: plus(t0, 2), status: "PICKED_UP", location: origin },
    ...events,
  ];

  switch (p.sku) {
    case "KW-HEADPHONES":
      return {
        ...base,
        fulfillment: {
          type: "SHIPMENT",
          carrier: "FEDEX",
          trackingNumber: tracking,
          service: "Express, signature required",
          shipToMatchesPayPalAddress: true,
          signatureRequired: true,
          signedBy: (seed.buyer?.name || "Recipient").toUpperCase(),
          packageWeightGrams: 612,
          deliveryStatus: "DELIVERED",
          events: shipped([
            { time: plus(t0, 3), status: "IN_TRANSIT", location: "Charlotte, NC hub" },
            { time: plus(t0, 4), status: "OUT_FOR_DELIVERY", location: dest },
            {
              time: plus(t0, 5),
              status: "DELIVERED",
              location: dest,
              detail: "Delivered to front door, signature obtained. GPS fix within 8 m of the delivery address.",
            },
          ]),
        },
        supportThread: [
          { time: plus(t0, 1), from: "store", text: `Hi ${firstName}, your headphones have shipped. Tracking: ${tracking}.` },
        ],
        internalNotes: [
          "Packed weight 612 g matches the catalogue weight for this SKU (610 g ± 15 g).",
          "Ship-to address is the address PayPal supplied at checkout.",
        ],
      };
    case "KW-MUG-SET":
      return {
        ...base,
        fulfillment: {
          type: "SHIPMENT",
          carrier: "UPS",
          trackingNumber: tracking,
          service: "Ground",
          shipToMatchesPayPalAddress: true,
          signatureRequired: false,
          packageWeightGrams: 1840,
          deliveryStatus: "EXCEPTION",
          events: shipped([
            { time: plus(t0, 3), status: "IN_TRANSIT", location: "Greenville, SC hub" },
            {
              time: plus(t0, 4),
              status: "EXCEPTION",
              location: "Greenville, SC hub",
              detail: "Package damaged in transit. Contents broken. Shipment will not be delivered; disposal authorised by carrier.",
            },
          ]),
        },
        supportThread: [
          { time: plus(t0, 1), from: "store", text: `Hi ${firstName}, your mug set is on its way. Tracking: ${tracking}.` },
        ],
        internalNotes: ["Carrier damage claim not yet filed. Declared value covers the order."],
      };
    case "KW-COURSE":
      return {
        ...base,
        fulfillment: {
          type: "DIGITAL",
          licenseKey: `KW-${(h % 0xffff).toString(16).toUpperCase().padStart(4, "0")}-MASTER`,
          accessLogs: [
            { time: plus(t0, 0), action: "ACCESS_EMAIL_SENT", ip: "-", device: "-", detail: `Sent to ${seed.buyer?.email || "the PayPal email"}` },
            { time: plus(t0, 1), action: "ACCOUNT_LOGIN", ip: `73.${h % 200}.${(h >> 8) % 250}.19`, device: "Chrome 141 on macOS", detail: "Login link opened from the access email" },
            { time: plus(t0, 2), action: "LESSON_STREAMED", ip: `73.${h % 200}.${(h >> 8) % 250}.19`, device: "Chrome 141 on macOS", detail: "Lesson 1: Centering (watched 100%)" },
            { time: plus(t0, 3), action: "LESSON_STREAMED", ip: `73.${h % 200}.${(h >> 8) % 250}.19`, device: "Chrome 141 on macOS", detail: "Lesson 2: Opening the clay (watched 100%)" },
            { time: plus(t0, 4), action: "FILE_DOWNLOADED", ip: `73.${h % 200}.${(h >> 8) % 250}.19`, device: "Chrome 141 on macOS", detail: "worksheets.zip (all 12 worksheets)" },
          ],
        },
        supportThread: [],
        internalNotes: [
          "The login IP geolocates to the same metro area as the PayPal billing address.",
          "No refund request was made through the course site before the dispute.",
        ],
      };
    case "KW-LAMP":
      return {
        ...base,
        fulfillment: {
          type: "SHIPMENT",
          carrier: "USPS",
          trackingNumber: tracking,
          service: "Priority Mail",
          shipToMatchesPayPalAddress: true,
          signatureRequired: false,
          packageWeightGrams: 1120,
          deliveryStatus: "DELIVERED",
          events: shipped([
            { time: plus(t0, 3), status: "IN_TRANSIT", location: "Regional facility" },
            { time: plus(t0, 5), status: "DELIVERED", location: dest, detail: "Delivered, in/at mailbox." },
          ]),
        },
        supportThread: [
          { time: plus(t0, 6), from: "customer", text: "The lamp arrived but it is matte black. I ordered the brass one shown in the photos." },
        ],
        internalNotes: [
          "Pick list scan for this order shows bin B-14 (matte black variant). The listing and the order are for brushed brass (bin B-12). Mis-pick confirmed by warehouse.",
          "Customer email above has not been answered yet.",
        ],
      };
    case "KW-STICKERS":
      return {
        ...base,
        fulfillment: {
          type: "SHIPMENT",
          carrier: "USPS",
          trackingNumber: "UNTRACKED",
          service: "First-class letter, no tracking",
          shipToMatchesPayPalAddress: true,
          signatureRequired: false,
          packageWeightGrams: 28,
          deliveryStatus: "LABEL_CREATED",
          events: [{ time: plus(t0, 1), status: "POSTED", location: origin, detail: "Stamped letter dropped at post office. No tracking available." }],
        },
        supportThread: [],
        internalNotes: ["Letter post: there is no carrier proof of delivery for this order."],
      };
    default:
      return undefined;
  }
}

export function saveOrderRecord(rec: OrderRecord): void {
  db().orders[rec.captureId] = rec;
  save();
}

export function findOrderRecord(captureId: string | undefined): OrderRecord | undefined {
  if (!captureId) return undefined;
  return db().orders[captureId];
}

/** Our `custom_id` on every PayPal order: lets us rebuild a lost record. */
export function encodeCustomId(sku: string): string {
  return `DD:${sku}`;
}
export function decodeCustomId(custom: string | undefined): string | undefined {
  return custom?.startsWith("DD:") ? custom.slice(3) : undefined;
}
