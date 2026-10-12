/*
 * Turns an answer into a fingerprint. The published question file holds only fingerprints
 * of the right answers, so they cannot be read from the page source; the page fingerprints
 * what the student entered and compares.
 *
 * The question file is produced with this same code, so the page and the answer key
 * always agree on how an answer is tidied and hashed.
 */
(() => {
  "use strict";

  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);

  // SHA-256 of a byte array. Written out here because crypto.subtle is missing on plain http pages.
  function sha256(bytes) {
    const h = new Uint32Array([
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ]);
    const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
    padded.set(bytes);
    padded[bytes.length] = 0x80;
    const view = new DataView(padded.buffer);
    view.setUint32(padded.length - 8, Math.floor(bytes.length / 0x20000000));
    view.setUint32(padded.length - 4, (bytes.length << 3) >>> 0);

    const w = new Uint32Array(64);
    for (let offset = 0; offset < padded.length; offset += 64) {
      for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
      for (let i = 16; i < 64; i++) {
        const x = w[i - 15];
        const y = w[i - 2];
        const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
        const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
        w[i] = w[i - 16] + s0 + w[i - 7] + s1;
      }
      let [a, b, c, d, e, f, g, last] = h;
      for (let i = 0; i < 64; i++) {
        const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        const t1 = (last + S1 + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
        const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        last = g;
        g = f;
        f = e;
        e = (d + t1) | 0;
        d = c;
        c = b;
        b = a;
        a = (t1 + t2) | 0;
      }
      h[0] += a;
      h[1] += b;
      h[2] += c;
      h[3] += d;
      h[4] += e;
      h[5] += f;
      h[6] += g;
      h[7] += last;
    }
    const out = new Uint8Array(32);
    const outView = new DataView(out.buffer);
    h.forEach((word, i) => outView.setUint32(i * 4, word));
    return out;
  }

  const utf8 = (text) => new TextEncoder().encode(text);
  const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

  /*
   * Tidies a typed answer so that harmless differences do not cost the point. Phones swap in
   * curly quotes and long dashes, so those are straightened for every mode.
   *   word     capitals, extra spaces, surrounding quotes and a final full stop are ignored
   *   command  spaces are collapsed and a leading "$ " prompt is dropped; capitals matter
   *   code     all whitespace is ignored; capitals matter
   *   number   spaces and thousands commas are ignored
   */
  function normalize(text, mode) {
    const s = String(text ?? "")
      .normalize("NFKC")
      .replace(/[‘’‚′]/g, "'")
      .replace(/[“”„″]/g, '"')
      .replace(/[‐-―−]/g, "-")
      .replace(/ /g, " ")
      .trim();
    if (mode === "code") return s.replace(/\s+/g, "");
    if (mode === "number") return s.replace(/[\s,]/g, "").replace(/\.$/, "");
    if (mode === "command") return s.replace(/^\$\s*/, "").replace(/\s+/g, " ");
    return s
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/^["'`]+|["'`]+$/g, "")
      .replace(/[.!?;,]+$/, "")
      .trim();
  }

  // One string per answer, whatever its kind: a choice, a set of ticks, an ordering or typed text.
  function canonical(kind, value, mode) {
    if (kind === "type") return normalize(value, mode);
    if (kind === "multi") return [...value].sort().join("\u0001");
    if (kind === "order") return value.join("\u0001");
    return String(value);
  }

  // The fingerprint is tied to the question number, so equal answers to different questions differ.
  function key(salt, rounds, id, kind, value, mode) {
    let digest = sha256(utf8(`${salt}\u0002${id}\u0002${kind}\u0002${canonical(kind, value, mode)}`));
    for (let i = 1; i < rounds; i++) digest = sha256(digest);
    return hex(digest).slice(0, 24);
  }

  window.SEAL = { key, normalize, sha256hex: (text) => hex(sha256(utf8(text))) };
})();
