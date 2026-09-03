"use client";

export interface MdsPoint {
  x: number;
  y: number;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dominantEigen(B: number[][], n: number): { val: number; vec: number[] } {
  const rnd = mulberry32(42);
  let vec = Array.from({ length: n }, () => rnd() - 0.5);
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  if (norm < 1e-12) return { val: 0, vec: Array(n).fill(0) };
  vec = vec.map((v) => v / norm);

  let eig = 0;
  for (let iter = 0; iter < 200; iter++) {
    const nv = Array(n).fill(0);
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) nv[i] += B[i][j] * vec[j];
    const nrm = Math.sqrt(nv.reduce((s, v) => s + v * v, 0));
    if (nrm < 1e-12) break;
    const nvec = nv.map((v) => v / nrm);
    const dot = nvec.reduce((s, v, i) => s + v * vec[i], 0);
    const conv = Math.abs(dot) > 1 - 1e-8;
    vec = nvec;
    if (conv) {
      eig = vec.reduce((s, v, i) => s + v * B[i].reduce((a, b, j) => a + b * vec[j], 0), 0);
      break;
    }
  }
  if (eig === 0) {
    eig = vec.reduce((s, v, i) => s + v * B[i].reduce((a, b, j) => a + b * vec[j], 0), 0);
  }
  return { val: eig, vec };
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom < 1e-12) return 0;
  return dot / denom;
}

export function pairwiseDistances(embeddings: number[][]): number[][] {
  const n = embeddings.length;
  const dist: number[][] = Array.from({ length: n }, () => Array(n).fill(1));
  for (let i = 0; i < n; i++) {
    dist[i][i] = 0;
    for (let j = i + 1; j < n; j++) {
      const d = Math.max(0.05, 1 - cosineSimilarity(embeddings[i], embeddings[j]));
      dist[i][j] = d;
      dist[j][i] = d;
    }
  }
  return dist;
}

export function mds2d(dist: number[][], width: number, height: number): MdsPoint[] {
  const n = dist.length;
  if (n === 0) return [];
  if (n === 1) return [{ x: width / 2, y: height / 2 }];

  const dSq = dist.map((row) => row.map((d) => d * d));
  const rowMeans = dSq.map((row) => row.reduce((a, b) => a + b, 0) / n);
  const colMeans = dSq[0].map((_, ci) => dSq.reduce((s, row) => s + row[ci], 0) / n);
  const grandMean = rowMeans.reduce((a, b) => a + b, 0) / n;

  const B = dSq.map((row, ri) =>
    row.map((_, ci) => -0.5 * (row[ci] - rowMeans[ri] - colMeans[ci] + grandMean))
  );

  const Bc = B.map((r) => [...r]);
  const e1 = dominantEigen(Bc, n);
  const B2 = Bc.map((row, ri) =>
    row.map((_, ci) => Bc[ri][ci] - e1.val * e1.vec[ri] * e1.vec[ci])
  );
  const e2 = dominantEigen(B2, n);

  const pos = Array.from({ length: n }, (_, i) => ({
    x: Math.sqrt(Math.abs(e1.val)) * (e1.vec[i] || 0),
    y: Math.sqrt(Math.abs(e2.val)) * (e2.vec[i] || 0),
  }));

  const xs = pos.map((p) => p.x);
  const ys = pos.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const pad = 30;
  const s = Math.min(
    (width - pad * 2) / (maxX - minX || 1),
    (height - pad * 2) / (maxY - minY || 1)
  );
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  return pos.map((p) => ({
    x: width / 2 + (p.x - cx) * s,
    y: height / 2 + (p.y - cy) * s,
  }));
}
