function parseTimeToken(token) {
  const t = token.trim();
  if (!t) return null;
  const cn = t.match(/^(?:(\d+)\s*[小时时])?\s*(?:(\d+)\s*分(?:钟)?)?\s*(?:(\d+(?:\.\d+)?)\s*秒)?$/);
  if (cn && (cn[1] || cn[2] || cn[3])) {
    const h = Number(cn[1] || 0);
    const m = Number(cn[2] || 0);
    const s = Number(cn[3] || 0);
    return ((h * 60 + m) * 60 + s) * 1e3;
  }
  if (t.includes(":")) {
    const parts = t.replace(",", ".").split(":");
    if (parts.length >= 2 && parts.length <= 3) {
      const nums = parts.map((p) => parseFloat(p));
      if (nums.some((n) => Number.isNaN(n))) return null;
      if (nums.length === 3) {
        const [h, m2, s2] = nums;
        return Math.round(((h * 60 + m2) * 60 + s2) * 1e3);
      }
      const [m, s] = nums;
      return Math.round((m * 60 + s) * 1e3);
    }
    return null;
  }
  if (/^\d+(\.\d+){1,2}$/.test(t)) {
    const parts = t.split(".").map(Number);
    if (parts.length === 2) {
      const [a, b] = parts;
      const decimalStr = t.split(".")[1];
      if (decimalStr.length === 1) {
        return Number(t) * 1e3;
      }
      return (a * 60 + b) * 1e3;
    }
    if (parts.length === 3) {
      const [h, m, s] = parts;
      return ((h * 60 + m) * 60 + s) * 1e3;
    }
  }
  if (/^\d+$/.test(t)) {
    const n = Number(t);
    if (n >= 5) return n * 1e3;
  }
  const cnMix = t.match(/^(\d+)\s*分\s*(\d+(?:\.\d+)?)\s*秒$/);
  if (cnMix) {
    return (Number(cnMix[1]) * 60 + Number(cnMix[2])) * 1e3;
  }
  return null;
}
function findTimeMatches(line) {
  const matches = [];
  const push = (raw, start, end) => {
    const ms = parseTimeToken(raw);
    if (ms === null) return;
    if (matches.some((x) => start < x.end && end > x.start)) return;
    matches.push({ ms, raw, start, end });
  };
  const wrapRe = /[[【（(]\s*([^\]】）)]{1,20})\s*[\]】）)]/g;
  let m;
  while ((m = wrapRe.exec(line)) !== null) {
    push(m[1], m.index, m.index + m[0].length);
  }
  const colonRe = /(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?)/g;
  while ((m = colonRe.exec(line)) !== null) {
    push(m[1], m.index, m.index + m[0].length);
  }
  const cnRe = /(?<=^|[\s\]】）)、,，:：])((?:\d+\s*[小时时]\s*)?(?:\d+\s*分(?:钟)?\s*)?(?:\d+(?:\.\d+)?\s*秒))(?=[\s,]|$)/g;
  while ((m = cnRe.exec(line)) !== null) {
    push(m[1], m.index, m.index + m[0].length);
  }
  const cnMinRe = /(?<=^|[\s\]】）)、,，:：])(\d+\s*[小时时](?:\s*\d+\s*分(?:钟)?)?)(?=[\s,]|$)/g;
  while ((m = cnMinRe.exec(line)) !== null) {
    push(m[1], m.index, m.index + m[0].length);
  }
  if (!matches.length) {
    const dotRe = /(?:^|\s)(\d{1,2}\.\d{1,2}(?:\.\d{1,2})?)(?=\s|$)/g;
    let m2;
    while ((m2 = dotRe.exec(line)) !== null) {
      const raw = m2[1];
      const start = m2.index + (m2[0].length - raw.length);
      push(raw, start, start + raw.length);
    }
  }
  if (!matches.length) {
    const numRe = /(?:^|[[【（(][^\]】）)]{1,12}[\]】）)]\s*)\s*(\d{1,4})(?=\s+\S)/;
    const nm = line.match(numRe);
    if (nm) {
      const raw = nm[1];
      const start = nm[0].lastIndexOf(raw);
      push(raw, start, start + raw.length);
    }
  }
  return matches.sort((a, b) => a.start - b.start);
}
const ROLE_BLACKLIST = /* @__PURE__ */ new Set([
  "\u6CE8\u610F",
  "\u5907\u6CE8",
  "\u8BF4\u660E",
  "\u63D0\u793A",
  "\u573A\u666F",
  "\u955C\u5934",
  "\u6CE8"
]);
function findRole(line) {
  const bracket = line.match(/^\s*[\[【（(]\s*([^\]】）)]{1,12})\s*[\]】）)]\s*/);
  if (bracket) {
    const name = bracket[1].trim();
    if (/^[\d:.,\s]+$/.test(name)) return null;
    if (name && !ROLE_BLACKLIST.has(name)) {
      return { role: name, start: 0, end: bracket[0].length };
    }
  }
  const colon = line.match(/^\s*([^\s:：]{1,10})\s*[:：]\s*/);
  if (colon) {
    const name = colon[1].trim();
    if (/^[[\]【】（()）\d:.,\s]+$/.test(name)) return null;
    if (name && !ROLE_BLACKLIST.has(name)) {
      return { role: name, start: 0, end: colon[0].length };
    }
  }
  return null;
}
function findInlineRole(line) {
  const m = line.match(/^\s*([\u4e00-\u9fa5A-Za-z]{1,10})\s+(?=\d{1,2}[:.]\d)/);
  if (m) {
    const name = m[1].trim();
    if (name && !ROLE_BLACKLIST.has(name)) {
      return { role: name, start: 0, end: m[0].length };
    }
  }
  return null;
}
function parseScript(raw) {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const cues = [];
  const roles = [];
  const warnings = [];
  let untimedCount = 0;
  let lastMs = 0;
  let lineNo = 0;
  for (const rawLine of lines) {
    lineNo++;
    let line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("#") || line.startsWith("//")) continue;
    let inlineRole = findRole(line);
    if (!inlineRole) inlineRole = findInlineRole(line);
    const times = findTimeMatches(line);
    let startMs;
    let endMs;
    if (times.length >= 1) {
      startMs = times[0].ms;
      if (times.length >= 2 && times[1].ms > times[0].ms) {
        endMs = times[1].ms;
      }
    }
    let stripped = line;
    if (times.length) {
      for (let i = times.length - 1; i >= 0; i--) {
        stripped = stripped.slice(0, times[i].start) + stripped.slice(times[i].end);
      }
    }
    if (inlineRole) {
      const roleLen = inlineRole.end;
      stripped = stripped.slice(Math.min(roleLen, stripped.length));
    }
    stripped = stripped.replace(/^[-–—>→:：\s、,，\]】）)]+/, "").replace(/[\[【（(]+$/, "").replace(/^[\[【（(]+/, "").replace(/[-–—>→\s、,，]+$/, "").trim();
    const postRole = findRole(stripped);
    if (postRole && (!inlineRole || postRole.role !== inlineRole.role)) {
      inlineRole = postRole;
      stripped = stripped.slice(postRole.end).replace(/^[-–—>→:：\s、,，\]】）)]+/, "").replace(/^[\[【（(]+/, "").trim();
    }
    let role;
    if (inlineRole) {
      role = inlineRole.role;
      if (role && !roles.includes(role)) roles.push(role);
    }
    const text = stripped.trim();
    if (!text) continue;
    if (/^\d+$/.test(text)) continue;
    if (startMs === void 0) {
      untimedCount++;
      startMs = lastMs;
    }
    lastMs = startMs;
    cues.push({ startMs, endMs, role, text, line: lineNo });
  }
  if (!cues.length) {
    warnings.push("\u6CA1\u6709\u89E3\u6790\u5230\u4EFB\u4F55\u53EF\u6717\u8BFB\u7684\u53F0\u8BCD");
  }
  if (untimedCount > 0) {
    warnings.push(`${untimedCount} \u884C\u6CA1\u68C0\u6D4B\u5230\u65F6\u95F4\uFF0C\u5DF2\u6309\u987A\u5E8F\u7D27\u968F\u4E0A\u4E00\u6761`);
  }
  return { cues, roles, untimedCount, warnings };
}
function formatMs(ms) {
  const total = Math.max(0, ms);
  const m = Math.floor(total / 6e4);
  const s = Math.floor(total % 6e4 / 1e3);
  const cs = Math.floor(total % 1e3 / 10);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}
function toLrc(cues, placedMs) {
  const lines = ["[ti:\u58F0\u7ED8 VoiceCanvas]"];
  cues.forEach((c, i) => {
    const ms = placedMs?.[i] ?? c.startMs;
    const m = Math.floor(ms / 6e4);
    const s = Math.floor(ms % 6e4 / 1e3);
    const cs = Math.floor(ms % 1e3 / 10);
    const stamp = `[${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}]`;
    const prefix = c.role ? `${c.role}\uFF1A` : "";
    lines.push(`${stamp}${prefix}${c.text}`);
  });
  return lines.join("\n");
}
export {
  formatMs,
  parseScript,
  toLrc
};
