/**
 * JSON file persistence
 * ---------------------
 * Saved places and watches each live in one JSON file under the data
 * directory (the /data volume in Docker). Writes go to a temp file that is then
 * renamed over the original, so a crash or power cut mid-write (this runs on a
 * Raspberry Pi) can never leave a half-written file behind.
 */
import fs from "fs";
import path from "path";

export class JsonFile {
  constructor(file) {
    this.file = file;
  }

  /* create the file with `initial` if it doesn't exist yet */
  ensure(initial) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    if (!fs.existsSync(this.file)) this.write(initial);
    return this;
  }

  /* throws on a missing or corrupt file: callers decide whether that's fatal */
  read() {
    return JSON.parse(fs.readFileSync(this.file, "utf8"));
  }

  /* corrupt or missing -> fallback; used where losing state beats refusing to boot */
  readOr(fallback) {
    try { return this.read(); } catch { return fallback; }
  }

  write(data) {
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, this.file);
  }
}
