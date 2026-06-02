export const GMA_SKUS = {
  'PL-RW-FL30-R': { name: 'First Look', type: 'single' },
  'PL-RW-BTS100-R': { name: 'Behind the Scenes', type: 'single' },
  'PL-RW-SL30-R': { name: 'Spotlight', type: 'single' },
  'PL-RW-SB15-R': { name: 'Stage Bright', type: 'single' },
  'PL-RW-RR50-R': { name: 'Radiance Ready', type: 'single' },
  'PL-RW-AA90-R': { name: 'All Access', type: 'single' },
  'PL-RW-FT72-R': { name: 'Finishing Touch', type: 'single' },
  'PL-RW-TOR2-R': {
    name: 'Overnight Recovery kit',
    type: 'kit_small',
    pieces: 2,
    components: [
      { name: 'All Access', quantity: 1 },
      { name: 'Stage Bright', quantity: 1 }
    ]
  },
  'PL-RW-TRE3-R': {
    name: 'Runway Essentials kit',
    type: 'kit_small',
    pieces: 3,
    components: [
      { name: 'First Look', quantity: 1 },
      { name: 'Spotlight', quantity: 1 },
      { name: 'Radiance Ready', quantity: 1 }
    ]
  },
  'PL-RW-TGP4-R': {
    name: 'Glow Protocol kit',
    type: 'kit_large',
    pieces: 4,
    components: [
      { name: 'Behind the Scenes', quantity: 1 },
      { name: 'Spotlight', quantity: 1 },
      { name: 'Radiance Ready', quantity: 1 },
      { name: 'Stage Bright', quantity: 1 }
    ]
  },
  'PL-RW-TDTNR5-R': {
    name: 'Day-to-Night kit',
    type: 'kit_large',
    pieces: 5,
    components: [
      { name: 'First Look', quantity: 1 },
      { name: 'Behind the Scenes', quantity: 1 },
      { name: 'Spotlight', quantity: 1 },
      { name: 'Radiance Ready', quantity: 1 },
      { name: 'All Access', quantity: 1 }
    ]
  },
  'PL-RW-TFR7-R': {
    name: 'Full Runway kit',
    type: 'kit_large',
    pieces: 7,
    components: [
      { name: 'First Look', quantity: 1 },
      { name: 'Behind the Scenes', quantity: 1 },
      { name: 'Spotlight', quantity: 1 },
      { name: 'Radiance Ready', quantity: 1 },
      { name: 'Stage Bright', quantity: 1 },
      { name: 'All Access', quantity: 1 },
      { name: 'Finishing Touch', quantity: 1 }
    ]
  }
};

export const SEED_PACK_RATES = {
  single_qty1: 2.6,
  single_qty2plus: 2.0,
  kit_small: 1.6,
  kit_large: 0.9,
  combo: 0.8,
  multipack: 0.5
};

export const DEFAULT_THRESHOLD = 10;
export const DEFAULT_BORDERLINE_MIN = 5;
