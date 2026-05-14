import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SCENARIOS = [
  { count: 74, items: [['PL-RW-SB15-R', 1, 42]] },
  { count: 58, items: [['PL-RW-FL30-R', 1, 38]] },
  { count: 43, items: [['PL-RW-SL30-R', 1, 58]] },
  { count: 30, items: [['PL-RW-AA90-R', 1, 76]] },
  { count: 24, items: [['PL-RW-TOR2-R', 1, 84]] },
  { count: 20, items: [['PL-RW-TGP4-R', 1, 116]] },
  { count: 14, items: [['PL-RW-SB15-R', 2, 42]] },
  { count: 9, items: [['PL-RW-RR50-R', 1, 38], ['PL-RW-SL30-R', 1, 58]] },
  { count: 7, items: [['PL-RW-TDTNR5-R', 1, 158]] },
  { count: 5, items: [['PL-RW-TFR7-R', 1, 236]] },
  { count: 4, items: [['PL-RW-AA90-R', 1, 76], ['PL-RW-SB15-R', 1, 42], ['PL-RW-SL30-R', 1, 58]] },
  { count: 3, items: [['PL-RW-AA90-R', 1, 76], ['PL-RW-BTS100-R', 1, 34], ['PL-RW-FL30-R', 1, 38], ['PL-RW-FT72-R', 1, 28], ['PL-RW-RR50-R', 1, 38], ['PL-RW-SB15-R', 1, 42], ['PL-RW-SL30-R', 1, 58]] },
  { count: 2, items: [['PL-RW-FT72-R', 1, 48]] },
  { count: 1, items: [['PL-RW-BTS100-R', 2, 34], ['PL-RW-SB15-R', 1, 42]] },
  { count: 4, items: [['OS-NRO30-R', 1, 51]], note: 'non-gma-filter-test' },
  { count: 2, items: [['PL-RW-SB15-R', 1, 42], ['OS-NRO30-R', 1, 51]], note: 'mixed-filter-test' }
];

const headers = [
  'id',
  'number',
  'receipt_printed',
  'status',
  'total_price',
  'marketplace_fees',
  'gross_profit_value',
  'gross_profit_percent',
  'cost_price',
  'cost_of_goods',
  'subtotal_price',
  'total_tax',
  'delivery_cost',
  'total_discounts',
  'total_discounts_legacy',
  'created_at',
  'delivery_method',
  'payment_type',
  'payment_created_at',
  'shipped_at',
  'cancelled_at',
  'cancel_reason',
  'notes',
  'customer_note',
  'channel_type',
  'channel',
  'channel_id',
  'customer_email',
  'customer_phone',
  'customer_mobile',
  'customer_remote_id',
  'billing_address_first_name',
  'billing_address_last_name',
  'billing_address_company',
  'billing_address_address1',
  'billing_address_address2',
  'billing_address_city',
  'billing_address_country',
  'billing_address_state',
  'billing_address_zip',
  'billing_address_phone',
  'shipping_address_first_name',
  'shipping_address_last_name',
  'shipping_address_company',
  'shipping_address_address1',
  'shipping_address_address2',
  'shipping_address_city',
  'shipping_address_country',
  'shipping_address_state',
  'shipping_address_zip',
  'number_of_lines',
  'sku',
  'upc',
  'quantity',
  'quantity_shipped',
  'price_per_unit',
  'price_per_unit_including_tax',
  'product_title',
  'variant_title',
  'order_remote_id',
  'additional_options',
  'variant_weight',
  'tracking_number',
  'due_date',
  'tags'
];

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function carrierForOrder(orderIndex) {
  const cycle = ['USPS Ground Advantage', 'USPS Ground Advantage', 'UPS Ground', ''];
  return cycle[orderIndex % cycle.length];
}

function makeRow(orderNumber, item, orderIndex, itemIndex, note) {
  const [sku, quantity, price] = item;
  const deliveryMethod = carrierForOrder(orderIndex);
  return {
    id: '',
    number: orderNumber,
    receipt_printed: 'false',
    status: 'awaiting_fulfilment',
    total_price: '',
    marketplace_fees: '',
    gross_profit_value: '',
    gross_profit_percent: '',
    cost_price: '',
    cost_of_goods: '',
    subtotal_price: price * quantity,
    total_tax: 0,
    delivery_cost: 0,
    total_discounts: 0,
    total_discounts_legacy: 0,
    created_at: '2026-05-12 09:00:00',
    delivery_method: deliveryMethod,
    payment_type: 'Test',
    payment_created_at: '2026-05-12 09:00:00',
    shipped_at: '',
    cancelled_at: '',
    cancel_reason: '',
    notes: 'GMA route test order',
    customer_note: '',
    channel_type: 'csv',
    channel: 'Runway by Christian Siriano',
    channel_id: '',
    customer_email: `gma-test-${orderIndex + 1}@example.com`,
    customer_phone: '5550000000',
    customer_mobile: '',
    customer_remote_id: `GMA-CUSTOMER-${String(orderIndex + 1).padStart(4, '0')}`,
    billing_address_first_name: 'GMA',
    billing_address_last_name: `Tester ${orderIndex + 1}`,
    billing_address_company: '',
    billing_address_address1: `${100 + orderIndex} Test Order Lane`,
    billing_address_address2: '',
    billing_address_city: 'Los Angeles',
    billing_address_country: 'US',
    billing_address_state: 'CA',
    billing_address_zip: '90001',
    billing_address_phone: '5550000000',
    shipping_address_first_name: 'GMA',
    shipping_address_last_name: `Tester ${orderIndex + 1}`,
    shipping_address_company: '',
    shipping_address_address1: `${100 + orderIndex} Test Order Lane`,
    shipping_address_address2: '',
    shipping_address_city: 'Los Angeles',
    shipping_address_country: 'US',
    shipping_address_state: 'CA',
    shipping_address_zip: '90001',
    number_of_lines: '',
    sku,
    upc: '',
    quantity,
    quantity_shipped: 0,
    price_per_unit: price,
    price_per_unit_including_tax: price,
    product_title: '',
    variant_title: '',
    order_remote_id: orderNumber,
    additional_options: '',
    variant_weight: '',
    tracking_number: '',
    due_date: '2026-06-04',
    tags: note ? `GMA-TEST-IMPORT|${note}` : 'GMA-TEST-IMPORT',
    _itemIndex: itemIndex
  };
}

const outputDir = resolve(process.cwd(), 'test-data');
mkdirSync(outputDir, { recursive: true });

const generatedRows = [];
let orderIndex = 0;

for (const scenario of SCENARIOS) {
  for (let scenarioIndex = 0; scenarioIndex < scenario.count; scenarioIndex += 1) {
    const orderNumber = `GMA-TEST-${String(1001 + orderIndex).padStart(4, '0')}`;
    scenario.items.forEach((item, itemIndex) => {
      generatedRows.push(makeRow(orderNumber, item, orderIndex, itemIndex, scenario.note));
    });
    orderIndex += 1;
  }
}

const csv = [
  headers.join(','),
  ...generatedRows.map((fullRow) => {
    return headers.map((header) => csvEscape(fullRow[header])).join(',');
  })
].join('\n');

const outputPath = resolve(outputDir, 'veeqo-gma-test-orders.csv');
writeFileSync(outputPath, csv);
console.log(`Created ${outputPath}`);
console.log(`Orders: ${orderIndex}`);
console.log(`CSV rows: ${generatedRows.length}`);
