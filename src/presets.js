/**
 * 8 Pre-Sculpted Cozy Pastel Island Presets (Presets 1-8) for eko Beta Test.
 * Each preset returns { tiles: Array<{q,r,elevation,type}>, props: Array<{q,r,type,rotDeg,colorIdx}> }.
 */

import { hexDistance, hexKey, inGrid } from './hex.js';

export const PRESET_META = [
  {
    id: 1,
    name: 'Starter Meadow Cove',
    subtitle: 'Sunlit bay, turquoise pond & cozy cottages',
    badge: '#8ee05a',
    accent: '#e2725b',
  },
  {
    id: 2,
    name: 'Twin Cliff Lighthouse',
    subtitle: 'Dramatic twin crags above a harbor channel',
    badge: '#f4c95d',
    accent: '#64b5f6',
  },
  {
    id: 3,
    name: 'Heart Pond Oasis',
    subtitle: 'Heart-shaped island with sparkling central lagoon',
    badge: '#f284b6',
    accent: '#38d9e8',
  },
  {
    id: 4,
    name: 'Pine Mountain Ridge',
    subtitle: 'Stepped 5-tier alpine cliffs & spruce groves',
    badge: '#4ca874',
    accent: '#e8d7b8',
  },
  {
    id: 5,
    name: 'Pastel Harbor Town',
    subtitle: 'Crescent seaside village in 5 pastel roofs',
    badge: '#64b5f6',
    accent: '#f083b0',
  },
  {
    id: 6,
    name: 'Spiral Terrace Garden',
    subtitle: 'Ascending spiral ledges & tranquil pools',
    badge: '#74c69d',
    accent: '#f4c95d',
  },
  {
    id: 7,
    name: 'Cozy Archipelago',
    subtitle: 'Three connected sunlit islets across the sea',
    badge: '#38d9e8',
    accent: '#e2725b',
  },
  {
    id: 8,
    name: 'Blank Ocean Canvas',
    subtitle: 'Single starter hex ready for free sculpting',
    badge: '#7dd3fc',
    accent: '#9be864',
  },
];

function makeBuilder() {
  const tileMap = new Map();
  const propMap = new Map();

  function setTile(q, r, elevation, type = 'land') {
    if (!inGrid(q, r)) return;
    if (elevation <= 0) {
      tileMap.delete(hexKey(q, r));
      propMap.delete(hexKey(q, r));
      return;
    }
    const elev = Math.max(1, Math.min(5, Math.round(elevation)));
    tileMap.set(hexKey(q, r), { q, r, elevation: elev, type });
    if (type === 'water') {
      propMap.delete(hexKey(q, r));
    }
  }

  function setProp(q, r, type, rotDeg = 0, colorIdx = 0) {
    const k = hexKey(q, r);
    const t = tileMap.get(k);
    if (!t || t.type !== 'land' || t.elevation <= 0) return;
    propMap.set(k, { q, r, type, rotDeg: ((rotDeg % 360) + 360) % 360, colorIdx: colorIdx % 5 });
  }

  function fillDisc(cq, cr, radius, elevFn) {
    for (let q = cq - radius; q <= cq + radius; q++) {
      for (let r = cr - radius; r <= cr + radius; r++) {
        const d = hexDistance(q, r, cq, cr);
        if (d <= radius && inGrid(q, r)) {
          const val = typeof elevFn === 'function' ? elevFn(q, r, d) : elevFn;
          if (val && typeof val === 'object') {
            setTile(q, r, val.elevation, val.type || 'land');
          } else if (val > 0) {
            setTile(q, r, val, 'land');
          }
        }
      }
    }
  }

  function build() {
    return {
      tiles: Array.from(tileMap.values()),
      props: Array.from(propMap.values()),
    };
  }

  return { setTile, setProp, fillDisc, build };
}

export function buildPresetData(presetId) {
  const id = Math.max(1, Math.min(8, Number(presetId) || 1));
  const b = makeBuilder();

  if (id === 1) {
    // 1. Starter Meadow Cove — iconic hero island with tiered cliffs, cove pond, cottages & trees!
    b.fillDisc(0, 0, 5, (q, r, d) => {
      // Carve an inviting sunny southern-east ocean cove opening
      if (q >= 2 && r >= 2 && d >= 4) return 0;
      if (q === 3 && r === 1) return 0;
      if (q === 4 && r === 0) return 0;
      if (q === -5 && r >= 2) return 0;
      if (d === 5 && (q >= 3 || (q + r * 2) % 2 !== 0)) return 0;
      // North-west lush sedimentary cliffs (levels 2-4)
      if (q <= -1 && r <= -1) {
        if (q === -2 && r === -2) return 4;
        if (d <= 3) return 3;
        return 2;
      }
      if (r <= -2 && q <= 1) return 2;
      if (q <= -2 && r === 0) return 2;
      return 1;
    });
    // Extend a couple organic peninsulas
    b.setTile(-3, 4, 1);
    b.setTile(-2, 4, 1);
    b.setTile(1, -5, 2);
    b.setTile(2, -5, 1);
    b.setTile(-4, -1, 2);

    // Sparkling freshwater central-west cove pond
    b.setTile(0, 1, 1, 'water');
    b.setTile(1, 1, 1, 'water');
    b.setTile(1, 0, 1, 'water');

    // Cozy pastel cottages framing the meadow & cliff terrace
    b.setProp(-1, 0, 'cottage', 30, 0); // Terracotta centerpiece
    b.setProp(-2, -1, 'cottage', 90, 2); // Buttercup on cliff ledge
    b.setProp(2, -2, 'cottage', 210, 3); // Sky Blue cottage
    b.setProp(-1, 3, 'cottage', 330, 4); // Berry Pink lakeside cottage
    b.setProp(0, -3, 'cottage', 150, 1); // Sage cliffside cottage

    // Lush Oaks, Pines, Flowering Bushes & Sedimentary Rocks
    b.setProp(-2, -2, 'pine', 15, 1);
    b.setProp(-3, -1, 'pine', 75, 1);
    b.setProp(-1, -3, 'pine', 120, 1);
    b.setProp(-3, -2, 'pine', 45, 1);
    b.setProp(1, -3, 'oak', 30, 1);
    b.setProp(3, -3, 'oak', 120, 1);
    b.setProp(-3, 1, 'oak', 60, 1);
    b.setProp(-2, 2, 'oak', 240, 1);
    b.setProp(2, 1, 'oak', 180, 1);
    b.setProp(0, 3, 'oak', 90, 2); // Golden accent oak
    b.setProp(-1, -1, 'oak', 15, 1);

    b.setProp(0, -1, 'bush', 0, 4);
    b.setProp(-2, 1, 'bush', 60, 2);
    b.setProp(2, -1, 'bush', 120, 4);
    b.setProp(-1, 2, 'bush', 180, 3);
    b.setProp(1, 2, 'bush', 240, 0);
    b.setProp(1, -2, 'bush', 30, 4);

    b.setProp(-4, 0, 'rock', 45, 0);
    b.setProp(-3, 3, 'rock', 120, 0);
    b.setProp(3, -1, 'rock', 210, 0);
    b.setProp(2, -4, 'rock', 90, 0);
    b.setProp(0, 4, 'rock', 15, 0);
    return b.build();
  }

  if (id === 2) {
    // 2. Twin Cliff Lighthouse Village
    b.fillDisc(-3, 0, 3, (q, r, d) => (d === 0 ? 5 : d === 1 ? 4 : d === 2 ? 2 : 1));
    b.fillDisc(3, 0, 3, (q, r, d) => (d === 0 ? 4 : d === 1 ? 3 : d === 2 ? 2 : 1));
    // Land bridge connecting the twin cliffs
    b.setTile(0, 0, 1);
    b.setTile(0, -1, 1);
    b.setTile(-1, 1, 1);
    b.setTile(1, -1, 1);
    b.setTile(0, 1, 1, 'water');

    b.setProp(-3, 0, 'cottage', 30, 0); // Summit lighthouse cottage
    b.setProp(3, 0, 'cottage', 210, 3); // East cliff cottage
    b.setProp(-2, 1, 'cottage', 90, 2);
    b.setProp(2, -1, 'cottage', 300, 4);
    b.setProp(-4, 1, 'pine', 0, 1);
    b.setProp(-3, -2, 'pine', 60, 1);
    b.setProp(-2, -2, 'pine', 120, 1);
    b.setProp(4, -1, 'oak', 30, 1);
    b.setProp(3, 2, 'oak', 150, 1);
    b.setProp(2, 1, 'bush', 0, 4);
    b.setProp(-1, -1, 'bush', 90, 2);
    b.setProp(0, -1, 'rock', 30, 0);
    b.setProp(-5, 2, 'rock', 180, 0);
    b.setProp(5, -2, 'rock', 75, 0);
    return b.build();
  }

  if (id === 3) {
    // 3. Heart Pond Oasis
    const heart = [
      [-2, -2], [-1, -2], [1, -2], [2, -2],
      [-3, -1], [-2, -1], [-1, -1], [0, -1], [1, -1], [2, -1], [3, -1],
      [-3, 0], [-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0], [3, 0],
      [-3, 1], [-2, 1], [-1, 1], [0, 1], [1, 1], [2, 1],
      [-2, 2], [-1, 2], [0, 2], [1, 2],
      [-1, 3], [0, 3],
      [-1, 4],
    ];
    for (const [q, r] of heart) {
      const outer = hexDistance(q, r, 0, 0) >= 3;
      b.setTile(q, r, outer ? 2 : 1, 'land');
    }
    // Heart-shaped sparkling turquoise pond inside!
    const pond = [[0, 0], [-1, 0], [1, -1], [0, 1], [-1, 1]];
    for (const [q, r] of pond) {
      b.setTile(q, r, 1, 'water');
    }
    b.setProp(-2, -1, 'cottage', 30, 4);
    b.setProp(2, -1, 'cottage', 270, 0);
    b.setProp(0, 3, 'cottage', 150, 2);
    b.setProp(-3, 0, 'oak', 15, 4); // Sakura pink oak!
    b.setProp(3, -1, 'oak', 90, 4);
    b.setProp(-2, 2, 'oak', 180, 1);
    b.setProp(2, 0, 'oak', 240, 1);
    b.setProp(0, -1, 'bush', 0, 4);
    b.setProp(-1, 2, 'bush', 60, 4);
    b.setProp(1, 1, 'bush', 120, 2);
    b.setProp(-3, 1, 'rock', 45, 4);
    b.setProp(1, 2, 'rock', 160, 0);
    return b.build();
  }

  if (id === 4) {
    // 4. Pine Mountain Ridge
    b.fillDisc(0, 0, 5, (q, r, d) => {
      if (d === 5 && Math.abs(q) > 2) return 0;
      const ridge = Math.abs(q + r * 0.5);
      if (ridge < 1.1 && d <= 2) return 5;
      if (ridge < 2.1 && d <= 3) return 4;
      if (d <= 3) return 3;
      if (d <= 4) return 2;
      return 1;
    });
    // High alpine tarn pond
    b.setTile(1, 1, 2, 'water');
    b.setTile(2, 0, 2, 'water');

    b.setProp(0, 0, 'cottage', 30, 0);
    b.setProp(-1, 2, 'cottage', 150, 1);
    b.setProp(2, -2, 'cottage', 270, 2);
    const pines = [
      [-1, -1], [0, -2], [1, -2], [-2, 0], [-2, 1], [-1, -3], [1, -3],
      [2, -3], [-3, 1], [-2, 3], [0, 3], [3, -2], [-1, 1], [0, -1],
    ];
    pines.forEach(([q, r], i) => b.setProp(q, r, 'pine', (i * 45) % 360, 1));
    b.setProp(1, 2, 'rock', 30, 3);
    b.setProp(-3, 2, 'rock', 120, 3);
    b.setProp(3, -1, 'rock', 210, 0);
    b.setProp(0, 2, 'bush', 0, 1);
    return b.build();
  }

  if (id === 5) {
    // 5. Pastel Harbor Town
    b.fillDisc(0, 0, 5, (q, r, d) => {
      // Wide sheltered harbor bay on the south-east
      if (q >= 0 && r >= 0 && d <= 3) return 0;
      if (q === 1 && r === 2) return 0;
      if (q === 2 && r === 1) return 0;
      if (d === 5 && r > 1) return 0;
      if (d >= 4 && r <= -1) return 3;
      if (r <= -2) return 2;
      if (q <= -3) return 2;
      return 1;
    });
    // Crescent row of all 5 pastel cottages!
    b.setProp(-2, 0, 'cottage', 60, 0);
    b.setProp(-1, -1, 'cottage', 30, 2);
    b.setProp(0, -2, 'cottage', 0, 3);
    b.setProp(2, -2, 'cottage', 330, 4);
    b.setProp(3, -2, 'cottage', 300, 1);
    b.setProp(-2, 2, 'cottage', 90, 3);
    b.setProp(-3, -1, 'cottage', 60, 0);

    b.setProp(-1, -3, 'oak', 30, 1);
    b.setProp(1, -3, 'oak', 90, 1);
    b.setProp(-3, 1, 'oak', 150, 2);
    b.setProp(4, -3, 'pine', 0, 1);
    b.setProp(-4, 0, 'pine', 60, 1);
    b.setProp(-1, 1, 'bush', 0, 4);
    b.setProp(1, -1, 'bush', 60, 2);
    b.setProp(3, -1, 'rock', 45, 0);
    b.setProp(-2, 3, 'rock', 180, 0);
    return b.build();
  }

  if (id === 6) {
    // 6. Spiral Terrace Garden
    const spiral = [
      [0, 0, 5], [1, 0, 4], [0, 1, 4], [-1, 1, 4], [-1, 0, 3], [0, -1, 3], [1, -1, 3],
      [2, -1, 3], [2, 0, 3], [1, 1, 3], [0, 2, 2], [-1, 2, 2], [-2, 2, 2], [-2, 1, 2],
      [-2, 0, 2], [-1, -1, 2], [0, -2, 2], [1, -2, 2], [2, -2, 2], [3, -2, 2],
      [3, -1, 1], [3, 0, 1], [2, 1, 1], [1, 2, 1], [0, 3, 1], [-1, 3, 1], [-2, 3, 1],
      [-3, 2, 1], [-3, 1, 1], [-3, 0, 1], [-2, -1, 1], [-1, -2, 1], [0, -3, 1],
      [1, -3, 1], [2, -3, 1],
    ];
    for (const [q, r, el] of spiral) {
      b.setTile(q, r, el, 'land');
    }
    b.setTile(1, 1, 3, 'water');
    b.setTile(-2, 1, 2, 'water');
    b.setTile(1, -2, 2, 'water');

    b.setProp(0, 0, 'cottage', 30, 2);
    b.setProp(-1, 1, 'oak', 0, 4);
    b.setProp(1, -1, 'oak', 120, 1);
    b.setProp(-2, 2, 'oak', 240, 1);
    b.setProp(2, -2, 'pine', 45, 1);
    b.setProp(0, 2, 'bush', 0, 4);
    b.setProp(-2, 0, 'bush', 60, 2);
    b.setProp(2, 0, 'bush', 120, 3);
    b.setProp(0, -2, 'bush', 180, 0);
    b.setProp(3, -1, 'rock', 30, 0);
    b.setProp(-3, 1, 'rock', 150, 0);
    return b.build();
  }

  if (id === 7) {
    // 7. Cozy Archipelago — three linked mini-islands!
    b.fillDisc(-3, 2, 2, (q, r, d) => (d === 0 ? 2 : 1));
    b.fillDisc(3, 1, 2, (q, r, d) => (d === 0 ? 3 : d === 1 ? 2 : 1));
    b.fillDisc(0, -3, 2, (q, r, d) => (d === 0 ? 2 : 1));
    // Stepping-stone connecting bridges
    b.setTile(-1, 1, 1);
    b.setTile(0, 1, 1);
    b.setTile(1, 0, 1);
    b.setTile(0, -1, 1);
    b.setTile(-1, -1, 1);
    b.setTile(0, -3, 2, 'water');

    b.setProp(-3, 2, 'cottage', 45, 0);
    b.setProp(3, 1, 'cottage', 225, 3);
    b.setProp(1, -3, 'cottage', 135, 4);
    b.setProp(-4, 2, 'oak', 0, 1);
    b.setProp(-2, 3, 'bush', 60, 2);
    b.setProp(4, 0, 'pine', 30, 1);
    b.setProp(3, 2, 'pine', 90, 1);
    b.setProp(-1, -3, 'oak', 180, 4);
    b.setProp(0, -4, 'bush', 120, 3);
    b.setProp(0, 1, 'rock', 15, 0);
    b.setProp(2, 2, 'rock', 105, 0);
    return b.build();
  }

  // 8. Blank Ocean Canvas — single lush starter hex at center
  b.setTile(0, 0, 1, 'land');
  return b.build();
}
