import { VERSION } from "./version.mjs";

export function helpText() {
  return `Vatio CLI ${VERSION}

  npx @vatio-ai/cli init my-agent  Start a workspace here
  npx @vatio-ai/cli push           Deploy it

  (installed globally with \`npm i -g @vatio-ai/cli\`, the command is just \`vatio\`)

To build and test an agent from a coding agent, connect the Vatio MCP
(https://vatio.ai/mcp) instead: \`npx @vatio-ai/skills\` adds it to the
project, then /vatio-init. Vatio holds the agent, and nothing goes in your
repository. The CLI is for a team that keeps the agent as files.

A workspace is any directory with a vatio.yml: commands read \`workspace:\`
from the vatio.yml at or above the cwd. --workspace SLUG (anywhere on the
command line) or VATIO_WORKSPACE names one instead, such as a workspace built
through the MCP, which has no vatio.yml; it wins over a vatio.yml, and the
command says so when the two differ. init, push, pull, diff and auth work on
the files, so they go by the directory alone: they refuse --workspace, and a
VATIO_WORKSPACE that names another workspace.

A push reaches your team at once (\`vatio chat\` and Try the agent talk to
it) and everyone once the tests that pass today pass on it, a few minutes
later; with no tests, at once. A test it breaks holds it back from everyone:
\`vatio status\` says which, and another push that fixes it, or removing a test
it made obsolete, moves it on. \`vatio rollback\` undoes the last change.

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
    push [--force]             Validate the workspace, then deploy it (the first
                               push signs in like \`login\`): your team has it
                               at once, everyone once its tests pass. Refused
                               over edits made outside your files (pull them
                               first); --force overwrites them
    pull [--force]             Write the deployed agent into vatio.yml's agent:
                               block and tools/, edits from the Vatio MCP
                               included. Wants vatio.yml and tools/ committed
                               to git; --force writes anyway
    rollback                   Put everyone, your team included, back on the
                               version before the last change: config and knowledge
    status                     Where the newest change stands (everyone has it,
                               its tests are running, or a test held it and
                               which), the replies Vatio wrote for the agent,
                               and your WhatsApp number when Meta refuses its sends
    diff                       What this directory would change
    diff --stat|--name-only|--format json|--full

  Talk to your agent (as yourself by default — the token is the identity):
    chat "message" [--file PATH]... [--new] [--as-phone me|PHONE]
         [--as-subject ID | --visitor-token JWT]
                               The newest version, the one your team has; --new
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
    chat export --from DATE [--to DATE] [--team] [--channel NAME] [--out FILE]
                               What people said and were answered between two
                               dates, redacted by Vatio, one conversation per
                               line as JSON: your customers', or your team's own
                               with --team. Any team member,
                               viewers included; every call is in the activity
    chat reply CHAT_ID "TEXT"  Write in a customer's conversation as a person on the
                               team: the agent stays out of it until
    chat release CHAT_ID       hands it back to the agent
    analytics [--days N]       The inbox's Analytics: conversations, messages, replies
                               Vatio saved, after hours, questions to the team
    testers [web|whatsapp|instagram] | rm whatsapp|instagram ID
                               Who reaches your team's version on Vatio's shared
                               number and account

  Test and improve it: what it should do, what supervisors reported, and how
  its tools answered (test add, test list, fix, push, test):
    tools [--period 1h|1d|7d|30d] [--json]
                               Each tool's calls, error rate, timeouts and
                               p50/p95, then the calls that failed with what
                               your backend answered, in your customers'
                               conversations. Default: 7d
    test [--agent SLUG] [--as-subject ID | --visitor-token JWT]
                               Test every report and test against your team's
                               version: starts the runs on Vatio's servers,
                               prints their ids and returns. A run that passes
                               also releases a change a test held back.
                               --as-subject replays every case signed in as
                               that visitor (see \`vatio chat\`)
    test --wait [--timeout N]  Wait for the judge and print the report; exits 1
                               if a case fails. Joins this version's running run
    test --show RUN_ID         One run's report so far, with the replay chat of
                               each case that did not pass (vatio chat show ID)
    test add "QUESTION" "WHAT IT SHOULD DO" [--as-phone me|PHONE] [--as-subject ID]
                               Ask it in a new chat and keep
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
    kb write BASE ENTRY [FILE] Write an entry, from FILE or stdin: your team has
                               it at once, everyone once the tests pass
    kb cat BASE ENTRY [--version N]
                               Print an entry's markdown, or one old version
    kb rm-entry BASE ENTRY     Delete one entry
    kb status BASE             What your team has that everyone does not have yet
    kb history BASE            What reached everyone, newest first

  Business (one value, everyone has it on save; also in the inbox,
  on the Web chat page):
    business [show]            Name and brand, and the old business description
                               if there is one
    business set [--name NAME] [--about TEXT] [--color #RRGGBB|default]
                 [--logo FILE | --remove-logo] [--clear-description]
                               What the business does goes in agent.instructions

  Quiet hours (when the agent does not answer; one schedule, everyone has it on
  save; also in the inbox, under Channels):
    quiet-hours [show]         The weekly schedule, and whether it is silent now
    quiet-hours set --timezone ZONE --range "DAYS HH:MM-HH:MM" [--range ...]
                               Replace the schedule. DAYS: mon, mon-fri, sat,sun, all
                               A range may cross midnight: "fri 22:00-08:00"
    quiet-hours off            Answer around the clock
    widget [show]              The web widget's look and greeting, and its snippet
    widget set [--title T] [--greeting G] [--suggestion S]... [--position left|right]
               [--scheme auto|light|dark] [--reply-style stream|paced] [--locale en|es|pt]

  Team (the owner's; the same roles as the inbox's Team page):
    team [list] [--json]       The owner and everyone invited, and who has not signed in yet
    team invite EMAIL --role viewer|supervisor|developer [--code CODE]
                               Invite them and email them. Needs a second factor on your
                               account: --code is your authenticator app's code
    team role EMAIL viewer|supervisor|developer [--code CODE]
                               Change what they reach; the same second factor
    team rm EMAIL              Take their access away
    team resend EMAIL          Email the invitation again
    team questions [--to EMAIL...|--none] [--template NAME [--language CODE]|--no-template]
                               Who the agent asks when it cannot answer a customer

  The workspace (the owner's, as the inbox's Security, Activity and Plan pages):
    security [show]            Whether everyone needs two-step verification, and how long
                               conversations are kept
    security set [--require-2fa on|off] [--retention-days N]
    activity [--category NAME] [--page N]
                               Who did what in the workspace, newest first
    support-access [show]      Whether Vatio staff can open the workspace now
    support-access open 24h|72h|7d | close
    transfer [show]            Handing the workspace to someone else
    transfer offer EMAIL [--code CODE] | cancel
    transfer accept SLUG [--code CODE] | decline SLUG
                               A workspace someone offered to you
    workspace delete SLUG [--yes] [--code CODE]
                               Delete it for everyone; it cannot be undone
    plan                       The plan and this period's conversations against it

  Credentials:
    secrets list|set KEY [VALUE] [--from-env [NAME]]|rm KEY [--tests]
                               Without VALUE, set asks for it with the input hidden.
                               --from-env takes the value from your shell or the
                               .env beside the workspace, so a coding agent can set
                               a secret without being shown it (NAME defaults to KEY).
                               With --tests, the value your team's conversations
                               with the agent and every test run use, like a
                               staging URL; otherwise the value everywhere
    keys list [--json]         API keys of both kinds: publishable (for a page or
                               app, with where it was used) and secret (for your
                               backend, with its scopes)
    keys create publishable|secret [--label NAME] [--json]
                               A publishable key works from any site
    keys create secret --test  A secret key that reaches only your team and the
                               customer phones you added, through Vatio's test
                               number: for your backend's development and staging
    keys create secret --scope NAME... [--code CODE | --recovery-code CODE]
                               What the secret key may call: messages, instagram,
                               chats, status, team (repeatable). Without --scope,
                               all but team. team (add people to the team) is the owner's,
                               with a code from their authenticator app
    keys revoke PREFIX
    auth --new-key             Keypair that signs the JWT saying who a visitor is

  Sending from your backend (with a server key):
    webhooks list|create URL [--event NAME]... [--test]|test ID|deliveries ID|enable ID|rm ID
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
                               two-step verification PIN, or the one it takes
                               when it has none) registers it on the Cloud API
                               first: the fix for a number not registered
    whatsapp disconnect [--yes]
    whatsapp invite EMAIL [--code CODE]
                               Ask whoever manages the number to connect it:
                               an email with the link (owner only)
    whatsapp team              The team and each person's own WhatsApp: the
                               phone the agent knows them by, and that reaches
                               it on Vatio's number
    whatsapp templates [list] [--test-number]
                               The number's templates and the "template" to send;
                               --test-number lists those on Vatio's test number
    whatsapp templates create NAME --language CODE --body TEXT [--example VALUE]...
                     [--category utility|marketing] [--footer TEXT]
                     [--button-url 'TEXT|URL']... [--button-example VALUE]...
                     [--button-phone 'TEXT|PHONE'] [--button-quick-reply TEXT]...
    whatsapp templates create [NAME] --components FILE [--language CODE]
                     [--category utility|marketing|authentication]
                     [--parameter-format positional|named]
                               Submit one for Meta's review: on your number, or
                               on Vatio's test number until you connect one
    whatsapp templates rm NAME [--language CODE] | sync
                               Delete one at Meta; pull back ones made elsewhere
    whatsapp failed [--test] [--since DATE] [--until DATE] [--error-code CODE]
                    [--error-contains TEXT] [--before ID]
                               Messages Vatio gave up retrying, with your
                               external_ref; --test for what your test secret
                               key sent

  Channels:
    instagram                  The same, for Instagram
    instagram link [--json]    The link to share with whoever holds the account:
                               they connect it with no Vatio account (7 days)

  Everything else:
    config show|get KEY|set KEY VALUE|unset KEY
                               Keys: base_url, token
    env [list]                 The version your team has and the one everyone
                               has, with the deployment each runs
    publish                    Nothing to do: a push reaches everyone once its
                               tests pass. Prints that and exits 0, for scripts

  Global flag: --workspace SLUG names the workspace (not for init, push, pull,
  diff, auth)

  Environment: VATIO_BASE_URL, VATIO_TOKEN, VATIO_WORKSPACE, VATIO_HOME,
  VATIO_NO_UPDATE_NOTIFIER, VATIO_TELEMETRY=0 (see vatio.ai/docs/cli/workspace#telemetry)

  Docs: https://vatio.ai/docs
`;
}
