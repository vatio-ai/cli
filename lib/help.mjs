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
    tools check                Validate the workspace against Vatio's contracts

  Talk to your agent (as yourself — the token is the identity):
    chat "message" [--env NAME]        preview by default; --env live is real
    chat transcript|debug|reset [--last N]
    chat show CHAT_ID [--json] Any chat in the workspace (web, WhatsApp, ...) with
                               its channel, environment, deployment and tool calls
    chat destroy CHAT_ID

  Improve it from what supervisors flagged:
    flags [--save [PATH]|--json]
                               Every open flag: the conversation, what each tool
                               answered, and what the reply should have been
    eval [--env NAME] [--agent SLUG] [--no-wait]
                               Replay every eval case (each flag is one) and
                               judge it; exits 1 if one fails. Default: the
                               branch's environment, else preview
    eval --show RUN_ID         One run's report

  Knowledge:
    kb [list]                  Bases, and whether a deployed agent reads each
    kb show NAME               One base: its sites and its entries
    kb create NAME | rm NAME
    kb write BASE ENTRY [FILE] Write an entry in this environment, from FILE or stdin
    kb cat BASE ENTRY [--version N]
                               Print an entry's markdown, or one old version
    kb rm-entry BASE ENTRY     Delete one entry in this environment
    kb follow BASE URL         Read a site into the base, nightly
    kb unfollow BASE URL | refresh BASE [URL]
    kb status BASE             What this environment changed that live does not
                               have, and what live changed underneath
    kb publish BASE            Take this environment's changes live, alone
    kb history BASE            What reached live, newest first
                               (entry commands take --env; --env live writes live)

  Credentials and the widget:
    secrets list|set KEY [VALUE]|rm KEY [--env NAME]
                               Without VALUE, set asks for it with the input hidden.
                               On a branch or with --env, the value only that
                               environment uses; otherwise the value everywhere
    tokens list|create [--env NAME] [--label NAME] [--origin URL]...|revoke PREFIX
    tokens origins PREFIX URL...
                               The origins a token is accepted from (replaces the list)
    widget [--env NAME]        What the platform enforces, and the tokens there are;
                               the look is edited in the console
    auth --new-key             Keypair that signs the JWT saying who a visitor is

  Channels (your own account serves live; each test phone or account on the shared
  preview reaches the environment it points at -- add and point take --env, and
  default to the branch you are on):
    whatsapp [status]|connect|check|activate|deactivate|disconnect
    whatsapp numbers list|add PHONE|point PHONE|verify PHONE CODE|resend PHONE|remove PHONE
    instagram [status]|connect|check|disconnect
    instagram accounts list|add @HANDLE|point ID|verify CODE|resend ID|remove ID

  Everything else:
    issue "what should change"|list|show ID|comment ID "reply"|--template
                               Sends your workspace along; --no-source to not
    mcp                        Speak MCP over stdio, for a coding agent
    config show|get KEY|set KEY VALUE|unset KEY
                               Keys: base_url, token

  Environment: VATIO_BASE_URL, VATIO_TOKEN, VATIO_HOME, VATIO_NO_UPDATE_NOTIFIER

  Docs: https://docs.vatio.ai
`;
}
