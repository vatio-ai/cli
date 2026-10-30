import { VERSION } from "./version.mjs";

export function helpText() {
  return `Vatio CLI ${VERSION}

  npx @vatio-ai/cli init my-agent  Start a workspace here
  npx @vatio-ai/cli push           Deploy it

  (installed globally with \`npm i -g @vatio-ai/cli\`, the command is just \`vatio\`)

A workspace is any directory with a vatio.yml. Every command except init reads
\`workspace:\` from the vatio.yml at or above the cwd — there is no --workspace
flag, the directory decides.

Until someone outside your team talks to your agent, \`push\` is the deploy:
live follows every one of them. From their first conversation on, a push waits
for \`publish\`, and that is what --env NAME is about: preview is the version
you are working on, live is what visitors talk to. Every push says which of
the two you are in. Commands default as listed.

  Getting started:
    init [SLUG] [--name NAME]  Create vatio.yml here, and the remote to match
    login [--base-url URL]     Sign this machine in from the browser: email link,
                               Google or GitHub. Creates the account if needed
    logout                     Revoke and forget the token
    whoami                     The account this machine is signed in as, and
                               the workspaces it reaches
    doctor                     Node, config, workspace, token and account status
    version                    What this CLI is
    changelog [--full]         Which release is current, what it changed since the
                               version you have, and how to get it (npm does the
                               updating; this only tells you). --full prints each
                               entry whole instead of its headlines
    docs [--save [PATH]]       The whole developer contract, live from Vatio
    docs PAGE                  One page of it: tools, cli/chat, guides/NAME...
    docs search TERM [--all]   The sections that mention TERM, with their page
                               and the lines around each match
    feedback "TEXT"            Tell the Vatio team what got in the way
    share-session ["FEEDBACK"] Send this Claude Code or Codex session to the
                               Vatio team, after showing what goes; feedback optional
                               (--save FILE, --list, --id ID; --yes from a
                               coding agent)
    share-session --should-ask Whether a coding agent should offer to send it
                               now: yes or no, and why
    share-session --never      Stop coding agents from offering

  Deploy:
    push [--force]             Validate the workspace, then deploy it; runs no
                               tests (the first push signs in like \`login\`).
                               Reaches your agent directly while the workspace
                               is a draft, and waits in preview once people
                               talk to it. Refused over edits made outside your
                               files (pull them first) and over an unpublished
                               push from another git branch; --force replaces
                               either
    pull [--env NAME] [--force]
                               Write the deployed agent into vatio.yml's agent:
                               block and tools/, edits from the Vatio MCP
                               included (default: preview). Wants vatio.yml and
                               tools/ committed to git; --force writes anyway
    publish [--force]          Take preview live, with its knowledge changes.
                               Once published, refused until \`vatio test\` has
                               tested preview's version, and while it fails a
                               report live passes; --force publishes anyway
    rollback                   Put live back to the previous snapshot: config and knowledge
    status                     Preview and live deployment state: which one
                               preview holds (branch, commit, uncommitted
                               changes, who pushed it and when, published or
                               not), the replies Vatio wrote for the agent, and
                               your WhatsApp number when Meta refuses its sends
    env [preview|live]         An environment: token, widget snippet, link,
                               knowledge changes and conflicts (default: preview)
    env list                   Both environments and what each runs
    diff [--env NAME]          What this directory would change (default: preview)
                               --env live answers "what would publishing change?"
    diff --stat|--name-only|--format json|--full

  Talk to your agent (as yourself by default — the token is the identity):
    chat "message" [--file PATH]... [--env NAME] [--new] [--as-phone me|PHONE]
         [--as-subject ID | --visitor-token JWT]
                               preview by default; --env live is real; --new
                               starts over as a visitor the agent never met,
                               in a new chat whose id it prints.
                               --file attaches an image, PDF, text or audio file
                               as a visitor would (up to 4, 8 MB each).
                               --as-phone speaks as your verified WhatsApp or
                               a customer phone; --as-subject signs a visitor
                               in with your identity key, so \`access: private\`
                               tools run
    chat --chat CHAT_ID "message"
                               Continue that chat, whatever .vatio-chat.json
                               says: for chats running side by side
    chat show [CHAT_ID] [--json] [--last N]
                               The chat you are in, or any chat in the workspace
                               (web, WhatsApp, ...): messages, tool calls, channel,
                               and what was read of each file (truncated, unreadable)
    chat export --from DATE [--to DATE] [--env NAME] [--channel NAME] [--out FILE]
                               What people said and were answered between two
                               dates, redacted by Vatio, one conversation per
                               line as JSON. Default: live. Any team member,
                               viewers included; every call is in the activity

  Test and improve it: what it should do, what supervisors reported, and how
  its tools answered (test add, test list, fix, push, test, publish):
    tools [--env NAME] [--period 1h|1d|7d|30d] [--json]
                               Each tool's calls, error rate, timeouts and
                               p50/p95, then the calls that failed with what
                               your backend answered. Default: live, 7d
    test [--env NAME] [--agent SLUG] [--as-subject ID | --visitor-token JWT]
                               Test every report and test against preview
                               (default): starts the runs on Vatio's servers,
                               prints their ids and returns.
                               --env live also resolves the reports it passes.
                               --as-subject replays every case signed in as
                               that visitor (see \`vatio chat\`)
    test --wait [--timeout N]  Wait for the judge and print the report; exits 1
                               if a case fails. Joins this version's running run
    test --show RUN_ID         One run's report so far, with the replay chat of
                               each case that did not pass (vatio chat show ID)
    test add "QUESTION" "WHAT IT SHOULD DO" [--as-phone me|PHONE] [--as-subject ID]
                               Ask it in a new chat (default: preview) and keep
                               the turn as a test, judged at once
    test add "WHAT IT SHOULD DO" [--chat ID|--message ID]
                               The same on a reply you already have: the agent's
                               last one in the chat \`vatio chat\` is in, or a
                               report's, whose note it rewrites
    test list [--save [PATH]|--json]
                               What to fix: open reports with their conversation
                               and what each tool answered, tests that fail or
                               answer differently each time; then every test
    test rm ID [ID...]         Remove a test, or a report (F-) and its test

  Knowledge:
    kb [list]                  Bases, and whether a deployed agent reads each
    kb show NAME               One base and its entries
    kb create NAME | rm NAME
    kb write BASE ENTRY [FILE] Write an entry in this environment, from FILE or stdin
    kb cat BASE ENTRY [--version N]
                               Print an entry's markdown, or one old version
    kb rm-entry BASE ENTRY     Delete one entry in this environment
    kb status BASE             What this environment changed that live does not
                               have, and what live changed underneath
    kb publish BASE            Take this environment's changes live, alone
    kb history BASE            What reached live, newest first
                               (entry commands take --env; --env live writes live)

  Business (one value for every environment, live on save; also in the inbox,
  on the Web chat page):
    business [show]            Name and brand, and the old business description
                               if there is one
    business set [--name NAME] [--about TEXT] [--color #RRGGBB|default]
                 [--logo FILE | --remove-logo] [--clear-description]
                               What the business does goes in agent.instructions

  Quiet hours (when the agent does not answer; one schedule for every environment,
  live on save; also in the inbox, under Channels):
    quiet-hours [show]         The weekly schedule, and whether it is silent now
    quiet-hours set --timezone ZONE --range "DAYS HH:MM-HH:MM" [--range ...]
                               Replace the schedule. DAYS: mon, mon-fri, sat,sun, all
                               A range may cross midnight: "fri 22:00-08:00"
    quiet-hours off            Answer around the clock

  Team (the owner's; the same roles as the inbox's Team page):
    team [list] [--json]       The owner and everyone invited, and who has not signed in yet
    team invite EMAIL --role viewer|supervisor|developer [--code CODE]
                               Invite them and email them. Needs a second factor on your
                               account: --code is your authenticator app's code. Removing
                               someone or changing a role stays in the inbox

  Credentials:
    secrets list|set KEY [VALUE] [--from-env [NAME]]|rm KEY [--env NAME | --tests]
                               Without VALUE, set asks for it with the input hidden.
                               --from-env takes the value from your shell or the
                               .env beside the workspace, so a coding agent can set
                               a secret without being shown it (NAME defaults to KEY).
                               With --env, the value only that environment uses;
                               otherwise the value everywhere. With --tests, the
                               value preview and every test run use, like a staging URL
    keys list [--json]         API keys of both kinds: publishable (for a page or
                               app) and secret (for your backend, with its scopes)
    keys create publishable|secret [--env NAME] [--label NAME] [--origin URL]... [--json]
                               --origin only for a publishable key
    keys create secret --scope NAME... [--code CODE | --recovery-code CODE]
                               What the secret key may call: messages, instagram,
                               chats, team (repeatable). Without --scope, all but
                               team. team (add people to the team) is the owner's,
                               with a code from their authenticator app
    keys origins PREFIX URL...
                               The origins a publishable key is accepted from
                               (replaces the list)
    keys revoke PREFIX
    auth --new-key             Keypair that signs the JWT saying who a visitor is

  Sending from your backend (with a server key):
    webhooks list|create URL [--event NAME]...|test ID|deliveries ID|enable ID|rm ID
                               Where Vatio tells your backend what happened

  Contacts (privacy requests on one person; the ID is the contact's number in the inbox):
    contacts export ID [--out FILE]
                               Everything Vatio keeps about them, as JSON: the contact,
                               channels, memories and conversations
    contacts delete ID [--yes] Delete them and everything about them, for good. Asks you
                               to type the ID; without a terminal, needs --yes

  WhatsApp (everything on the inbox's WhatsApp page; --json on each):
    whatsapp [status]          Your number, whether it is live, and its problems
                               (first: a Meta error that fails every send)
    whatsapp connect           Where to connect your number (Meta's consent
                               screen only opens in the inbox)
    whatsapp live on|off       Answer everyone who writes, or nobody
    whatsapp check [--pin PIN] Check the number with Meta and re-subscribe it;
                               a pass clears its problem. --pin (its 6-digit
                               two-step verification PIN) registers it on the
                               Cloud API again first: the fix for 133010
    whatsapp disconnect [--yes]
    whatsapp invite EMAIL [--code CODE]
                               Ask whoever manages the number to connect it:
                               an email with the link (owner only)
    whatsapp team              The team and each person's own WhatsApp: the
                               phone the agent knows them by, and that reaches
                               it on Vatio's number
    whatsapp templates [list] [--env live]
                               The number's templates and the "template" to send
    whatsapp templates create NAME --language CODE --body TEXT [--example VALUE]...
                     [--category utility|marketing] [--footer TEXT]
                               Submit one for Meta's review: on your number, or
                               on Vatio's test number until you connect one
    whatsapp templates rm NAME [--language CODE] | sync
                               Delete one at Meta; pull back ones made elsewhere
    whatsapp failed [--since DATE] [--until DATE] [--error-code CODE]
                    [--error-contains TEXT] [--before ID]
                               Messages Vatio gave up retrying, with your
                               external_ref (default: live)

  Channels:
    instagram                  The same, for Instagram

  Everything else:
    config show|get KEY|set KEY VALUE|unset KEY
                               Keys: base_url, token

  Environment: VATIO_BASE_URL, VATIO_TOKEN, VATIO_HOME, VATIO_NO_UPDATE_NOTIFIER,
  VATIO_TELEMETRY=0 (see vatio.ai/docs/cli/workspace#telemetry)

  Docs: https://vatio.ai/docs
`;
}
