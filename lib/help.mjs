import { VERSION } from "./version.mjs";

export function helpText() {
  return `Vatio CLI ${VERSION}

  npx @vatio-ai/cli init my-agent  Start a workspace here
  npx @vatio-ai/cli push           Deploy it to a preview

  (installed globally with \`npm i -g @vatio-ai/cli\`, the command is just \`vatio\`)

A workspace is any directory with a vatio.yml. Every command except init reads
\`workspace:\` from the vatio.yml at or above the cwd — there is no --workspace
flag, the directory decides.

--env NAME targets an environment: live, preview, or a branch's own. On a git
branch other than the default one, the branch's environment is the default
(fix/pagos -> fix-pagos): its own agent, knowledge changes and secret values,
and the one its pull request deploys to. Elsewhere commands default as listed.

  Getting started:
    init [SLUG] [--name NAME]  Create vatio.yml here, and the remote to match
    login [--base-url URL]     Authorize this machine in a browser
    logout                     Forget the token
    doctor                     Node, config, workspace and token status
    version                    What this CLI is
    docs [--save [PATH]]       The whole developer contract, live from Vatio

  Deploy:
    push [--env NAME]          Validate the workspace, then update a preview
    publish [--env NAME]       Promote an environment to live, with its knowledge
                               changes. Without --env or a branch, the latest
                               push. Refused when GitHub is connected: merge
                               the branch's pull request instead
    rollback                   Put live back to the previous snapshot: config and knowledge
    status                     Preview and live deployment state
    env [NAME]                 This environment: token, widget snippet, link,
                               knowledge changes and conflicts
    env list | rm NAME         Every environment / remove one and what it holds
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

  Improve it from what supervisors flagged:
    flags [--save [PATH]|--json]
                               Every open flag: the conversation, what each tool
                               answered, and what should have happened
    eval [--env NAME] [--agent SLUG] [--no-wait]
                               Replay every eval case (each flag is one) and
                               judge it; exits 1 if one fails. Default: the
                               branch's environment, else preview
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
    secrets list|set KEY [VALUE]|rm KEY [--env NAME]
                               Without VALUE, set asks for it with the input hidden.
                               On a branch or with --env, the value only that
                               environment uses; otherwise the value everywhere
    tokens list|create [--env NAME] [--label NAME] [--origin URL]...|revoke PREFIX
    tokens origins PREFIX URL...
                               The origins a token is accepted from (replaces the list)
    auth --new-key             Keypair that signs the JWT saying who a visitor is

  Channels:
    whatsapp                   Set up in the console; prints the link
    instagram                  Set up in the console; prints the link

  Everything else:
    config show|get KEY|set KEY VALUE|unset KEY
                               Keys: base_url, token

  Environment: VATIO_BASE_URL, VATIO_TOKEN, VATIO_HOME, VATIO_NO_UPDATE_NOTIFIER

  Docs: https://docs.vatio.ai
`;
}
