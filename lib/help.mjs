import { VERSION } from "./version.mjs";

export function helpText() {
  return `Vatio CLI ${VERSION}

  npx @vatio-ai/cli init my-agent  Start a workspace here
  npx @vatio-ai/cli push           Deploy it to preview

  (installed globally with \`npm i -g @vatio-ai/cli\`, the command is just \`vatio\`)

A workspace is any directory with a vatio.yml. Every command except init reads
\`workspace:\` from the vatio.yml at or above the cwd — there is no --workspace
flag, the directory decides.

--env NAME targets an environment, and there are two: preview (the next
version, what \`vatio push\` updates) and live (what visitors talk to).
Commands default as listed.

  Getting started:
    init [SLUG] [--name NAME]  Create vatio.yml here, and the remote to match
    login [--base-url URL]     Sign this machine in from the browser: email link,
                               Google or GitHub. Creates the account if needed
    logout                     Revoke and forget the token
    doctor                     Node, config, workspace and token status
    version                    What this CLI is
    docs [--save [PATH]]       The whole developer contract, live from Vatio
    feedback "TEXT"            Tell the Vatio team what got in the way
    share-session ["FEEDBACK"] Send this Claude Code session to the Vatio team,
                               after showing what goes; feedback optional
                               (--save FILE, --list, --id ID; --yes from a
                               coding agent)
    share-session --should-ask Whether a coding agent should offer to send it
                               now: yes or no, and why
    share-session --never      Stop coding agents from offering

  Deploy:
    push [--force]             Validate the workspace, then update preview; runs
                               no tests (the first push signs in like \`login\`).
                               --force replaces an unpublished push from
                               another git branch
    publish [--force]          Take preview live, with its knowledge changes.
                               Once published, refused until \`vatio eval\` has
                               tested preview's version, and while it fails a
                               report live passes; --force publishes anyway
    rollback                   Put live back to the previous snapshot: config and knowledge
    status                     Preview and live deployment state
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

  Improve it from what supervisors reported and how its tools answered
  (flags, fix, push, eval, publish):
    flags [--save [PATH]|--json]
                               Every open report: the conversation, what each tool
                               answered, and what should have happened
    tools [--env NAME] [--period 1h|1d|7d|30d] [--json]
                               The console's Tools page: each tool's calls, error
                               rate, timeouts and p50/p95, then the calls that
                               failed with what your backend answered. Default:
                               live, 7d
    eval [--env NAME] [--agent SLUG] [--no-wait] [--timeout N]
                               Test every report with a note against preview
                               (default) and judge it; exits 1 if one fails.
                               Can take minutes: in Claude Code, run it in the
                               background
    eval --show RUN_ID         One run's report

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

  Business (one value for every environment, live on save; also on the inbox's
  Business page):
    business [show]            Name, description, brand, opening hours, handoff rules
    business set [--name NAME] [--description TEXT | --description-file FILE]
                 [--about TEXT] [--color #RRGGBB|default] [--logo FILE | --remove-logo]
    business hours --timezone ZONE --mon 09:00-18:00 --tue 09:00-13:00,14:00-18:00 ...
                               Replaces the week: a day not given is closed
    business hours --clear     No hours: someone is always available

  Credentials:
    secrets list|set KEY [VALUE]|rm KEY [--env NAME | --tests]
                               Without VALUE, set asks for it with the input hidden.
                               With --env, the value only that environment uses;
                               otherwise the value everywhere. With --tests, the
                               value preview and every eval use, like a staging URL
    tokens list|create [--env NAME] [--label NAME] [--origin URL]...|revoke PREFIX
    tokens origins PREFIX URL...
                               The origins a token is accepted from (replaces the list)
    keys list|create [--env NAME] [--label NAME]|revoke PREFIX
                               Server keys, for your backend to call the server API
    auth --new-key             Keypair that signs the JWT saying who a visitor is
    auth --supabase [URL] [--sign-in-url URL]
                               Your users sign in with Supabase: verify their
                               session, no keys or signing code

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

  Channels:
    whatsapp                   Set up in the console; prints the link (Test page
                               until you publish, then Integrations)
    instagram                  The same, for Instagram

  Everything else:
    config show|get KEY|set KEY VALUE|unset KEY
                               Keys: base_url, token

  Environment: VATIO_BASE_URL, VATIO_TOKEN, VATIO_HOME, VATIO_NO_UPDATE_NOTIFIER,
  VATIO_TELEMETRY=0 (see vatio.ai/docs/cli/workspace#telemetry)

  Docs: https://vatio.ai/docs
`;
}
