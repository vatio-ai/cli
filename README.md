# @vatio-ai/cli

The CLI for [Vatio](https://vatio.ai) — a production runtime for
customer-facing AI agents. Describe an agent in one `vatio.yml` and deploy it to
web chat, WhatsApp and Instagram; Vatio runs the conversation, the contacts, the
identity, the safeguards and the handoff to a human.

```bash
npx @vatio-ai/cli init my-agent
npx @vatio-ai/cli push
```

No runtime to install first: if you have Node 20 or newer, you have this.

The package is `@vatio-ai/cli`; the command it installs is `vatio`. So
`npm install -g @vatio-ai/cli` gives you `vatio push`, and `npx @vatio-ai/cli push`
is the same thing without installing anything.

## If you are a coding agent

```bash
vatio docs --save   # the whole developer contract as markdown, live from Vatio
```

`vatio docs` prints the same contract that
[docs.vatio.ai/docs.md](https://docs.vatio.ai/docs.md) serves, and
`vatio docs --save` writes it next to the workspace.

Don't guess `vatio.yml` keys. Unknown root keys fail validation, and the rules
that judge a workspace live on the server — so the printed contract is the
current one by construction.

## What a workspace is

A directory with a `vatio.yml` in it:

```text
support-agent/
  vatio.yml          # required: the agent, its tools, its knowledge
  tools/*.yml        # one HTTP request each, described in YAML
  identity.pub       # public key that verifies the JWT saying who a visitor is
```

Only create the files you need. Nothing constrains where that directory lives —
an agent can sit inside the repository of the backend it calls, and every
command except `init` finds it by walking up from the current directory. There
is no `--workspace` flag.

## Commands

```
init [SLUG]                 Create vatio.yml here, and the remote to match
login | logout              Authorize this machine in a browser, or forget it
doctor                      Node, config, workspace and token status

push [--env NAME]           Validate the workspace, then update a preview
publish [--env NAME]        Promote the latest push to live, or the named preview
diff [--env NAME]           What this directory would change
status                      Preview and live deployment state
rollback                    Restore the previous live deployment

chat "message" [--env NAME] [--new]
                            Talk to your own agent; the token is the identity
chat show [CHAT_ID] [--json]
                            The chat you are in, or any chat in the workspace, with its tool calls

kb list|show|create|rm       Knowledge bases
kb write|cat|rm-entry        Entries, from a file or stdin

secrets list|set|rm          Credentials your tools read
tokens list|create|origins|revoke  Publishable tokens and the origins each accepts
auth --new-key               Keypair that signs the visitor's JWT
auth --supabase [URL]        Your users sign in with Supabase: no keys, no code

whatsapp | instagram         Set up in the console; prints the link

docs [--save [PATH]]         The whole developer contract
config show|set|unset        base_url and token, per developer
```

`--env NAME` targets a deployment: `live`, `preview`, or a named preview like
`pr-42`.

Run `npx @vatio-ai/cli help` for the whole surface, and see
[docs.vatio.ai](https://docs.vatio.ai) for the platform.

## Where your credentials live

`~/.vatio/config.json`, or `$VATIO_HOME/config.json` — per developer, never
inside a repository. `VATIO_BASE_URL` and `VATIO_TOKEN` override it for one
command, which is what CI should use.

## Where the rules live

Whether a workspace is valid is answered by Vatio, not by this package: `push`
and `diff` send the directory and read the result back. So the rules that
judge your workspace are always the deployed ones, and this CLI never has to be
upgraded to understand a new one.

## Issues

Bugs and questions go to [issues](https://github.com/vatio-ai/cli/issues). This repository is a read-only mirror of
the CLI as it ships inside Vatio, so a pull request cannot be merged here: open
an issue describing the change instead. Release notes live in the
[changelog](https://docs.vatio.ai/changelog).
