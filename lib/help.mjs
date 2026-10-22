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
    status                     Preview and live deployment state, and the replies
                               Vatio wrote for the agent, and why
    env [preview|live]         An environment: token, widget snippet, link,
                               knowledge changes and conflicts (default: preview)
    env list                   Both environments and what each runs
    diff [--env NAME]          What this directory would change (default: preview)
                               --env live answers "what would publishing change?"
    diff --stat|--name-only|--format json|--full

  Talk to your agent (as yourself — the token is the identity):
    chat "message" [--env NAME] [--new]
                               preview by default; --env live is real; --new
                               starts over as a visitor the agent never met
    chat show [CHAT_ID] [--json] [--last N]
                               The chat you are in, or any chat in the workspace
                               (web, WhatsApp, ...): messages, tool calls, channel
    chat export --from DATE [--to DATE] [--env NAME] [--channel NAME] [--out FILE]
                               What people said and were answered between two
                               dates, redacted by Vatio, one conversation per
                               line as JSON. Default: live. Any team member,
                               viewers included; every call is in the activity

  Improve it from what supervisors reported and how its tools answered
  (flags, fix, push, test, publish):
    flags [--save [PATH]|--json]
                               Every open report: the conversation, what each tool
                               answered, and what should have happened
    flags add "NOTE" [--chat ID|--message ID] [--env NAME]
                               Flag a reply and what should have happened:
                               the agent's last one in the chat \`vatio chat\`
                               is in (default: preview). On live it is a report
                               and a test case; on preview, a note for your
                               coding agent that the next push closes
    flags rm ID [ID...]        Remove a report and its test case, open or
                               resolved, as the inbox's Remove does
    tools [--env NAME] [--period 1h|1d|7d|30d] [--json]
                               Each tool's calls, error rate, timeouts and
                               p50/p95, then the calls that failed with what
                               your backend answered. Default: live, 7d
    test [--env NAME] [--agent SLUG]
                               Test every report and test against preview
                               (default): starts the runs on Vatio's servers,
                               prints their ids and returns.
                               --env live also resolves the reports it passes
    test --wait [--timeout N]  Wait for the judge and print the report; exits 1
                               if a case fails. Joins this version's running run
    test --show RUN_ID         One run's report so far, with the replay chat of
                               each case that did not pass (vatio chat show ID)
    test add "NOTE" [--chat ID|--message ID] [--env NAME]
                               Keep a reply as a test of what it should do: the
                               agent's last one in the chat \`vatio chat\` is in
    test list [--json] | test rm ID [ID...]
                               The tests \`test add\` made; reports are \`flags\`
    eval                       Deprecated: \`vatio test --wait\` under its old name

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
  under Channels → Web widget):
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
                               Invite them and email them. With a second factor on your
                               account, --code is your authenticator app's code. Removing
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
    tokens list|create [--env NAME] [--label NAME] [--origin URL]... [--json]|revoke PREFIX
    tokens origins PREFIX URL...
                               The origins a token is accepted from (replaces the list)
    keys list|create [--env NAME] [--label NAME]|revoke PREFIX
                               Server keys, for your backend to call the server API
    auth --new-key             Keypair that signs the JWT saying who a visitor is
    auth --supabase [URL] [--sign-in-url URL]
                               Your users sign in with Supabase: verify their
                               session, no keys or signing code

  Recover outbound WhatsApp messages (with your developer login):
    Vatio retries confirmed failures automatically. Inspect terminal failures:
    messages failed [--since DATE] [--until DATE] [--error-code CODE]
                    [--error-contains TEXT] [--before ID] [--json]
                               List failed outgoing messages, including Meta's
                               delivery failures (default: live)

  Sending from your backend (WhatsApp, with a server key):
    templates list [--env live] [--json]
                               The number's templates, parameter counts, and the
                               "template" object to send
    templates create NAME --language CODE --body TEXT [--example VALUE]...
                     [--category utility|marketing] [--footer TEXT] [--json]
                               Submit a template for Meta's review: on your number,
                               or on Vatio's test number until you connect one;
                               one --example per {{n}} in the body
    webhooks list|create URL [--event NAME]...|test ID|deliveries ID|enable ID|rm ID
                               Where Vatio tells your backend what happened

  Claude Code routines (WhatsApp):
    routines list|create NAME --url URL --phone NUMBER...|update ID|test ID|runs ID|enable ID|rm ID
                               A routine on claude.ai the agent hands work to, as a
                               tool (tools/NAME.yml with routine: NAME), in
                               conversations with these numbers

  Channels:
    whatsapp                   Set up in the inbox; prints the link (Try the agent
                               until you publish, then Channels)
    whatsapp test-phones [--json]
                               The phones verified in Try the agent, to send a
                               preview message to
    whatsapp only NUMBER...|everyone
                               Who the agent answers on your own number; the
                               rest still reach the inbox
    instagram                  The same, for Instagram

  Everything else:
    config show|get KEY|set KEY VALUE|unset KEY
                               Keys: base_url, token

  Environment: VATIO_BASE_URL, VATIO_TOKEN, VATIO_HOME, VATIO_NO_UPDATE_NOTIFIER,
  VATIO_TELEMETRY=0 (see vatio.ai/docs/cli/workspace#telemetry)

  Docs: https://vatio.ai/docs
`;
}
