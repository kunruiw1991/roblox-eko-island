/**
 * Axial Hexagonal Grid Math for eko Beta Test (Pointy-Top along Z).
 * Radius 10 => 3 * 10 * 11 + 1 = 331 interactive hex columns.
 */

export const GRID_RADIUS = 10;
export const HEX_RADIUS = 1.65;
export const LEVEL_HEIGHT = 1.05;
export const MAX_ELEVATION = 5;
export const TILE_LIMIT = 1000;
export const OCEAN_Y = 0.0;

const SQRT3 = Math.sqrt(3);

export const HEX_DIRS = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];

export function hexKey(q, r) {
  return `${q},${r}`;
}

export function hexDistance(q1, r1, q2 = 0, r2 = 0) {
  const dq = q1 - q2;
  const dr = r1 - r2;
  return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) * 0.5;
}

export function inGrid(q, r) {
  return hexDistance(q, r, 0, 0) <= GRID_RADIUS;
}

export function hexToWorld(q, r) {
  const x = HEX_RADIUS * SQRT3 * (q + r * 0.5);
  const z = HEX_RADIUS * 1.5 * r;
  return { x, z };
}

export function worldToHex(x, z) {
  const qf = ((SQRT3 / 3) * x - (1 / 3) * z) / HEX_RADIUS;
  const rf = ((2 / 3) * z) / HEX_RADIUS;
  return axialRound(qf, rf);
}

export function axialRound(qf, rf) {
  const sf = -qf - rf;
  let rq = Math.round(qf);
  let rr = Math.round(rf);
  let rs = Math.round(sf);

  const qDiff = Math.abs(rq - qf);
  const rDiff = Math.abs(rr - rf);
  const sDiff = Math.abs(rs - sf);

  if (qDiff > rDiff && qDiff > sDiff) {
    rq = -rr - rs;
  } else if (rDiff > sDiff) {
    rr = -rq - rs;
  }
  return { q: rq === 0 ? 0 : rq, r: rr === 0 ? 0 : rr };
}

export function getNeighbors(q, r) {
  const out = [];
  for (let i = 0; i < 6; i++) {
    const nq = q + HEX_DIRS[i][0];
    const nr = r + HEX_DIRS[i][1];
    if (inGrid(nq, nr)) {
      out.push({ q: nq, r: nr, key: hexKey(nq, nr) });
    }
  }
  return out;
}

/**
 * Generates all 331 hex coordinates within GRID_RADIUS sorted in spiral rings from (0,0).
 */
export function generateAllHexCoords() {
  const list = [];
  for (let q = -GRID_RADIUS; q <= GRID_RADIUS; q++) {
    const rMin = Math.max(-GRID_RADIUS, -q - GRID_RADIUS);
    const rMax = Math.min(GRID_RADIUS, -q + GRID_RADIUS);
    for (let r = rMin; r <= rMax; r++) {
      const { x, z } = hexToWorld(q, r);
      list.push({
        q,
        r,
        key: hexKey(q, r),
        x,
        z,
        dist: hexDistance(q, r, 0, 0),
      });
    }
  }
  list.sort((a, b) => a.dist - b.dist || a.r - b.r || a.q - b.q);
  return list;
}

/**
 * Computes the walkable / prop-placement surface Y for a given hex tile.
 */
export function getTileSurfaceY(tile) {
  if (!tile || tile.elevation <= 0) return OCEAN_Y;
  if (tile.type === 'water') {
    // Freshwater pond sits slightly recessed into the tier rim
    return Math.max(0.28, tile.elevation * LEVEL_HEIGHT - 0.22);
  }
  return tile.elevation * LEVEL_HEIGHT;
}

export const PROP_TYPES = ['oak', 'pine', 'bush', 'rock', 'cottage'];

export const COLOR_SWATCH_NAMES = [
  'Terracotta',
  'Sage',
  'Buttercup',
  'Sky Blue',
  'Berry Pink',
];

export const COLOR_SWATCH_HEX = [
  '#e2725b',
  '#74c69d',
  '#f4c95d',
  '#64b5f6',
  '#f284b6',
];

/**
 * Tailored pastel palettes per prop type across the 5 recolor indices.
 */
export const PROP_COLOR_PALETTES = {
  cottage: [0xe2725b, 0x6ec494, 0xf2c94c, 0x64b5f6, 0xf083b0],
  oak: [0xe58a54, 0x79cf5b, 0xf0c954, 0x6dc7c1, 0xf294b9],
  pine: [0xc97b58, 0x4ca874, 0xcab958, 0x5ba8c4, 0xd980a8],
  bush: [0xf27d64, 0x9de07c, 0xffe066, 0x7cc8fa, 0xff8ec0],
  rock: [0xd9cfc1, 0xc4d0c5, 0xe5d8b8, 0xbecad4, 0xdfc4cd],
};

export const DEFAULT_PROP_COLOR_IDX = {
  cottage: 0, // Terracotta
  oak: 1, // Sage / bright meadow green
  pine: 1, // Cozy pine sage
  bush: 4, // Berry pink flowers
  rock: 0, // Warm cream-tan sandstone
};
