import { GMA_SKUS } from './constants.js';

const DEMO_SCENARIOS = [
  { count: 72, price: 42, items: [['PL-RW-SB15-R', 1]] },
  { count: 54, price: 38, items: [['PL-RW-FL30-R', 1]] },
  { count: 41, price: 58, items: [['PL-RW-SL30-R', 1]] },
  { count: 28, price: 76, items: [['PL-RW-AA90-R', 1]] },
  { count: 22, price: 84, items: [['PL-RW-TOR2-R', 1]] },
  { count: 18, price: 116, items: [['PL-RW-TGP4-R', 1]] },
  { count: 13, price: 67, items: [['PL-RW-SB15-R', 2]] },
  { count: 9, price: 96, items: [['PL-RW-RR50-R', 1], ['PL-RW-SL30-R', 1]] },
  { count: 7, price: 158, items: [['PL-RW-TDTNR5-R', 1]] },
  { count: 4, price: 140, items: [['PL-RW-AA90-R', 1], ['PL-RW-SB15-R', 1], ['PL-RW-SL30-R', 1]] },
  { count: 3, price: 236, items: [['PL-RW-AA90-R', 1], ['PL-RW-BTS100-R', 1], ['PL-RW-FL30-R', 1], ['PL-RW-FT72-R', 1], ['PL-RW-RR50-R', 1], ['PL-RW-SB15-R', 1], ['PL-RW-SL30-R', 1]] },
  { count: 2, price: 48, items: [['PL-RW-FT72-R', 1]] },
  { count: 1, price: 112, items: [['PL-RW-BTS100-R', 2], ['PL-RW-SB15-R', 1]] }
];

const NOISE_SCENARIOS = [
  { count: 14, channel: 'Onsen Secret', price: 64, items: [['OS-NRO30-R', 1]] },
  { count: 8, channel: 'Runway', price: 42, items: [['PL-RW-SB15-R', 1]] },
  { count: 5, channel: 'Runway by Christian Siriano', price: 51, items: [['OS-NRO30-R', 1]] },
  { count: 3, channel: 'Runway by Christian Siriano', price: 86, items: [['PL-RW-SB15-R', 1], ['OS-NRO30-R', 1]] }
];

function lineItem([sku, quantity], index) {
  return {
    id: index + 1,
    quantity,
    sellable: {
      sku_code: sku,
      full_title: GMA_SKUS[sku]?.name || sku
    }
  };
}

function makeOrder({ id, number, channel, status, price, items }) {
  const carrierCycle = ['USPS Ground Advantage', 'USPS Ground Advantage', 'UPS Ground', ''];
  const hasPhone = id % 23 !== 0;
  const hasAddressWarning = id % 37 === 0;
  const hasFraudWarning = id % 41 === 0;
  return {
    id,
    number,
    status,
    channel: { name: channel },
    customer: {
      full_name: `GMA Tester ${id % 1000}`,
      email: `gma-demo-${id}@example.com`,
      phone: hasPhone ? '5550000000' : ''
    },
    deliver_to: {
      first_name: 'GMA',
      last_name: `Tester ${id % 1000}`,
      address1: `${100 + (id % 400)} Test Order Lane`,
      city: 'Los Angeles',
      state: 'CA',
      zip: '90001',
      country: 'US',
      phone: hasPhone ? '5550000000' : '',
      validated: !hasAddressWarning,
      verified: !hasAddressWarning,
      location_found: true,
      validation_message: hasAddressWarning ? 'Address requires manual verification.' : null
    },
    created_at: new Date(Date.UTC(2026, 5, 1, 14, 0, id % 60)).toISOString(),
    delivery_method: carrierCycle[id % carrierCycle.length],
    total_price: price,
    subtotal_price: price,
    line_items: items.map(lineItem),
    tags: hasFraudWarning ? [{ id: id + 10, name: 'Fraud (low)', colour: '#80ff80' }] : []
  };
}

export function buildDemoOrders() {
  const orders = [];
  let id = 900000000;
  let number = 3000;

  for (const scenario of DEMO_SCENARIOS) {
    for (let index = 0; index < scenario.count; index += 1) {
      orders.push(makeOrder({
        id: id += 1,
        number: `#CBS-DEMO-${number += 1}`,
        channel: 'Runway by Christian Siriano',
        status: 'awaiting_fulfillment',
        price: scenario.price,
        items: scenario.items
      }));
    }
  }

  for (const scenario of NOISE_SCENARIOS) {
    for (let index = 0; index < scenario.count; index += 1) {
      orders.push(makeOrder({
        id: id += 1,
        number: `#N${number += 1}`,
        channel: scenario.channel,
        status: 'awaiting_fulfillment',
        price: scenario.price,
        items: scenario.items
      }));
    }
  }

  return orders;
}
