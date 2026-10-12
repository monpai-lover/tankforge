import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { validateFullBank } from "../src/game/audioFull.js";
import { loadReloadAudio } from "./load-reload-audio.mjs";
const MIME = { ".wav": "audio/wav", ".mp3": "audio/mpeg", ".ogg": "audio/ogg" };
function loadFullAudio(repositoryRoot, { maxEncodedBytes = 24 * 1024 * 1024 } = {}) {
  const root = path.resolve(repositoryRoot), file = path.join(root, "client/web/assets/full-audio.json");
  if (!fs.existsSync(file)) return null;
  const m = JSON.parse(fs.readFileSync(file, "utf8"));
  if (m.schemaVersion !== 1 || m.bankId !== "full-game-v1" || m.selectionState !== "user-directed" || m.adoption?.source !== "human-direct-instruction" || m.adoption.statement !== "\u540C\u6642\u5B8C\u6210\u6240\u6709\u7684\u97F3\u6548\u751F\u6210\u548C\u66FF\u63DB" || !Array.isArray(m.profiles) || !m.cues) throw new Error("Full audio requires explicit production adoption");
  const cues = {}, hashes = /* @__PURE__ */ new Map();
  let payload = 0;
  const entries = Array.isArray(m.cues) ? m.cues.map((c) => [c.id, c]) : Object.entries(m.cues);
  for (const [id, c] of entries) {
    if (cues[id] || c.readyForGame !== true || !["NOT RUN", "PASS"].includes(c.subjectiveAudition) || !/^[a-f0-9]{64}$/.test(c.sha256) || typeof c.file !== "string" || path.isAbsolute(c.file) || c.file.includes("\\") || c.file.includes("\0")) throw new Error("Unselected or unsafe full audio cue");
    const resolved = path.resolve(root, c.file), directory = path.join(root, "client/web/assets/full-audio"), relative = path.relative(directory, resolved);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Full audio escaped export directory");
    let component = root;
    for (const part of path.relative(root, resolved).split(path.sep)) {
      if (!part || /[:\0]/.test(part)) throw new Error("Unsafe full audio component");
      component = path.join(component, part);
      if (fs.lstatSync(component).isSymbolicLink() || fs.realpathSync.native(component).toLowerCase() !== component.toLowerCase()) throw new Error("Linked full audio export");
    }
    const mime = MIME[path.extname(resolved).toLowerCase()];
    if (!mime) throw new Error("Unsupported full audio format");
    const bytes = fs.readFileSync(resolved), hash = createHash("sha256").update(bytes).digest("hex");
    if (!bytes.length || hash !== c.sha256) throw new Error("Full audio waveform hash mismatch");
    let url = hashes.get(hash);
    if (!url) {
      payload += 4 * Math.ceil(bytes.length / 3);
      if (payload > maxEncodedBytes) throw new Error("Full audio payload exceeds limit");
      url = `data:${mime};base64,${bytes.toString("base64")}`;
      hashes.set(hash, url);
    }
    cues[id] = { url, sha256: hash, loop: c.loop, durationSeconds: c.durationSeconds, level: c.level, subjectiveAudition: c.subjectiveAudition };
  }
  const externalCues = {};
  if (m.externalCues && Object.keys(m.externalCues).length) {
    const accepted = loadReloadAudio(root, { maxEncodedBytes });
    for (const [id, c] of Object.entries(m.externalCues)) {
      if (!accepted.cues[id] || c.sha256 && c.sha256 !== accepted.cues[id].sha256) throw new Error("External loading cue is not the accepted selection");
      const cue = accepted.cues[id];
      if (!hashes.has(cue.sha256)) {
        payload += cue.url.length - cue.url.indexOf(",") - 1;
        if (payload > maxEncodedBytes) throw new Error("Full audio payload exceeds limit");
        hashes.set(cue.sha256, cue.url);
      }
      externalCues[id] = { ...cue, url: hashes.get(cue.sha256), loop: false, durationSeconds: c.durationSeconds ?? 3, level: c.level ?? 0.8 };
    }
  }
  const bank = { ...m, cues, externalCues };
  if (!validateFullBank(bank)) throw new Error("Invalid full audio profiles or dangling cue reference");
  return bank;
}
export {
  loadFullAudio
};
