// What the CLI says when the first argument is not a command.
//
// It used to print `Unknown command: X` and the whole help, and the telemetry
// says that ended the session: of 31 sessions that hit
// `Unknown command: @vatio-ai/cli`, none ran another command afterwards. A
// coding agent reading a wall of help text does not find its mistake in it;
// it needs the one line that says what to run instead.
//
// Three kinds of mistake get named rather than guessed at:
//
//   - The way the CLI is started used as a command: `@vatio-ai/cli`, `npx`,
//     `vatio`. `npx @vatio-ai/cli @vatio-ai/cli push` is the shape the
//     telemetry shows, and the package name is the most abandoned error in
//     the whole dataset.
//   - A subcommand without its command: `show` is `vatio chat show` or
//     `vatio kb show`, and on its own it is neither.
//   - A message without `chat`: `vatio "do you deliver?"` is a sentence
//     somebody meant to say to their agent.
//
// Anything left is matched by edit distance, which catches the ordinary typo
// (`puhs`, `publsh`) and declines to guess when nothing is close.

// Every command the dispatch in bin/vatio.mjs answers. Kept here rather than
// read out of that switch so the suggestion works without parsing source at
// runtime; scripts/check-docs.mjs fails the build when the two drift apart,
// which is what keeps this honest.
export const COMMANDS = [
  "auth",
  "business",
  "changelog",
  "chat",
  "config",
  "contacts",
  "diff",
  "docs",
  "doctor",
  "env",
  "eval",
  "feedback",
  "flags",
  "init",
  "instagram",
  "kb",
  "keys",
  "login",
  "logout",
  "messages",
  "publish",
  "pull",
  "push",
  "quiet-hours",
  "rollback",
  "secrets",
  "share-session",
  "status",
  "team",
  "templates",
  "test",
  "tools",
  "version",
  "webhooks",
  "whatsapp",
  "whoami"
];

// Words that only mean something after a command. A token that is one of
// these is a dropped command, not a typo, so it is answered with the commands
// it belongs to instead of by edit distance.
//
// Only subcommands that are not also commands in their own right: `test`,
// `publish`, `status` and `rollback` are dispatched before this is reached, so
// listing them here would be dead. scripts/check-docs.mjs checks the command
// names on the right against the dispatch.
const SUBCOMMAND_OF = {
  add: ["flags", "test"],
  cat: ["kb"],
  create: ["kb", "keys", "templates", "webhooks"],
  delete: ["contacts"],
  deliveries: ["webhooks"],
  enable: ["webhooks"],
  export: ["chat", "contacts"],
  failed: ["messages"],
  follow: ["kb"],
  get: ["config"],
  history: ["kb"],
  invite: ["team"],
  list: ["env", "kb", "secrets", "keys", "team", "templates", "webhooks", "test"],
  off: ["quiet-hours"],
  origins: ["keys"],
  refresh: ["kb"],
  remove: ["secrets", "webhooks", "flags", "test"],
  revoke: ["keys"],
  rm: ["env", "kb", "secrets", "webhooks", "flags", "test"],
  "rm-entry": ["kb"],
  set: ["business", "quiet-hours", "secrets", "config"],
  show: ["chat", "kb", "business", "quiet-hours", "config"],
  "test-phones": ["whatsapp"],
  unfollow: ["kb"],
  unset: ["config"],
  write: ["kb"]
};

// Exported so scripts/check-docs.mjs can check every command named above is
// one the CLI actually dispatches.
export const SUBCOMMAND_OWNERS = [...new Set(Object.values(SUBCOMMAND_OF).flat())];

// How the CLI is started. None of them is a command, and all of them turn up
// as one when a wrapper is pasted twice.
const STARTERS = new Set(["npx", "npm", "node", "vatio", "@vatio-ai/cli", "cli", "--yes", "-y", "exec"]);

const PACKAGE_NAME = /^@vatio-ai\/cli(@[\w.^~-]+)?$/;

// A first argument that is a sentence rather than a word: what somebody meant
// to say to their agent, with `chat` left out.
function looksLikeMessage(token) {
  return /\s/.test(token) || /[?¿!¡]$/.test(token) || token.split(/\s+/).length > 1;
}

// Optimal string alignment: a substitution, an insertion, a deletion or a
// swap of two adjacent characters each cost one. The swap matters -- `puhs`
// for `push` is the commonest typo there is, and plain Levenshtein scores it
// as two mistakes and then declines to guess.
function editDistance(a, b) {
  if (a === b) return 0;

  const rows = a.length + 1;
  const cols = b.length + 1;
  const grid = Array.from({ length: rows }, () => new Array(cols).fill(0));

  for (let row = 0; row < rows; row += 1) grid[row][0] = row;
  for (let col = 0; col < cols; col += 1) grid[0][col] = col;

  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const cost = a[row - 1] === b[col - 1] ? 0 : 1;
      grid[row][col] = Math.min(
        grid[row - 1][col] + 1,
        grid[row][col - 1] + 1,
        grid[row - 1][col - 1] + cost
      );
      if (row > 1 && col > 1 && a[row - 1] === b[col - 2] && a[row - 2] === b[col - 1]) {
        grid[row][col] = Math.min(grid[row][col], grid[row - 2][col - 2] + 1);
      }
    }
  }
  return grid[a.length][b.length];
}

// How far off a token may be and still be called a typo: a third of its
// length, so short names are not matched to each other (`env` to `eval`) and
// long ones tolerate the two-character slip (`quiet-hour`, `share-sesion`).
function tolerance(token) {
  return token.length <= 4 ? 1 : Math.max(1, Math.floor(token.length / 3));
}

// The commands a token could be, nearest first. Exported for the help text
// and for anything else that wants to be forgiving about a name.
export function nearestCommands(token, { limit = 3 } = {}) {
  const needle = String(token).toLowerCase();
  if (needle === "") return [];

  const scored = COMMANDS.map((command) => {
    if (command.startsWith(needle) || needle.startsWith(command)) return { command, score: 0 };
    if (command.includes(needle) && needle.length >= 3) return { command, score: 1 };
    return { command, score: editDistance(needle, command) + 1 };
  })
    .filter(({ score }) => score <= tolerance(needle) + 1)
    .sort((a, b) => a.score - b.score || a.command.localeCompare(b.command));

  if (scored.length === 0) return [];

  // Only the closest, and the others only when they are exactly as close.
  // `publsh` is one edit from `publish` and two from `push`, so offering both
  // would make the reader choose between a match and a near miss.
  const best = scored[0].score;
  return scored.filter(({ score }) => score === best).slice(0, limit).map(({ command }) => command);
}

// The whole message for a first argument that is not a command: what went
// wrong, the one thing to run instead when that can be known, and where the
// rest of the surface is. Never the full help -- the reader already could not
// find the command in it.
export function unknownCommandMessage(command, args = []) {
  const token = String(command);
  const rest = args.filter((arg) => !STARTERS.has(arg) && !PACKAGE_NAME.test(arg));
  const trailing = rest.length > 0 ? ` ${rest.join(" ")}` : "";

  // The starter can arrive as the whole invocation in one argument, when a
  // generated command line was quoted: `vatio "@vatio-ai/cli push"`. Read the
  // first word, and carry the remaining words over as the command.
  const words = token.split(/\s+/).filter(Boolean);
  const head = words[0] ?? "";
  if (PACKAGE_NAME.test(head) || STARTERS.has(head)) {
    const carried = words.slice(1).filter((word) => !STARTERS.has(word) && !PACKAGE_NAME.test(word));
    const after = [...carried, ...rest].join(" ");
    return [
      `\`${head}\` is how the CLI is started, not a command it takes.`,
      "",
      `Run: vatio${after === "" ? " push" : ` ${after}`}`,
      "",
      "Installed globally the command is `vatio`; through npx the whole invocation is",
      "`npx @vatio-ai/cli ARGS` and the package name is not repeated.",
      "",
      "`vatio help` lists every command."
    ].join("\n");
  }

  if (looksLikeMessage(token)) {
    return [
      `\`${token}\` is not a command. To say it to your agent, \`chat\` takes the message:`,
      "",
      `Run: vatio chat ${JSON.stringify(token)}`,
      "",
      "`vatio help` lists every command."
    ].join("\n");
  }

  const belongsTo = SUBCOMMAND_OF[token.toLowerCase()];
  if (belongsTo) {
    const options = belongsTo.map((owner) => `vatio ${owner} ${token}${trailing}`);
    return [
      `\`${token}\` is a subcommand, so it needs the command it belongs to:`,
      "",
      ...options.map((option) => `  ${option}`),
      "",
      "`vatio help` lists every command."
    ].join("\n");
  }

  const near = nearestCommands(token);
  if (near.length === 1) {
    return [
      `Unknown command: ${token}. The closest is \`${near[0]}\`.`,
      "",
      `Run: vatio ${near[0]}${trailing}`,
      "",
      "`vatio help` lists every command."
    ].join("\n");
  }
  if (near.length > 1) {
    return [
      `Unknown command: ${token}. Did you mean one of these?`,
      "",
      ...near.map((option) => `  vatio ${option}${trailing}`),
      "",
      "`vatio help` lists every command."
    ].join("\n");
  }

  return [
    `Unknown command: ${token}.`,
    "",
    `Commands: ${COMMANDS.join(", ")}`,
    "",
    "`vatio help` explains each one, and `vatio docs` prints the whole contract."
  ].join("\n");
}
