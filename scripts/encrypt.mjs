import { randomBytes, createCipheriv, pbkdf2Sync } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SECRET_KEY = process.env.SECRET_KEY;
const TARGET_DATE = process.env.TARGET_DATE;
const OUTPUT = process.env.OUTPUT ?? 'api/message.json';

const USAGE =
  'Usage: SECRET_KEY="..." TARGET_DATE="YYYY-MM-DD" [OUTPUT="api/message.json"] \\\n' +
  '         node scripts/encrypt.mjs "your message here"';

if (!SECRET_KEY || !TARGET_DATE) {
  console.error(USAGE);
  process.exit(1);
}

const message = process.argv[2];
if (!message) {
  console.error(USAGE);
  process.exit(1);
}

const salt = randomBytes(16);
const key = pbkdf2Sync(SECRET_KEY + TARGET_DATE, salt, 100_000, 32, 'sha256');
const iv = randomBytes(12);

const cipher = createCipheriv('aes-256-gcm', key, iv);
let encrypted = cipher.update(message, 'utf8', 'hex');
encrypted += cipher.final('hex');
const tag = cipher.getAuthTag();

const result = {
  iv: iv.toString('hex'),
  tag: tag.toString('hex'),
  data: encrypted,
  salt: salt.toString('hex'),
};

// OUTPUT is resolved relative to the process CWD, not the script's location,
// so the dev-script can invoke this from the repo root with a simple path.
const outPath = resolve(process.cwd(), OUTPUT);
writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n');

console.log(`Encrypted message written to ${OUTPUT}`);
