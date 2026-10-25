# @vatio-ai/cli

The CLI for [Vatio](https://vatio.ai), which gives the app you're building with
a coding agent — Claude Code, Cursor or Codex — an AI agent that knows the app
and its users. Your coding agent writes the agent into your project and drives
this CLI; Vatio runs the conversations, with your users signed in, an inbox for
your team, handoff to a person, and the replies your team reports turned into
tests.

## Start here

In your app's project:

```bash
npx @vatio-ai/skills
```

Then, in Claude Code, run `/vatio-init` (in Cursor or Codex, ask it to use
vatio-init). It reads your app, asks only what the code can't answer, and
pushes a preview for you to try. Then `/vatio-add-to-app` puts the agent in
your web, iOS, Android or Flutter app. See the [docs](https://vatio.ai/docs/).

## By hand

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
[vatio.ai/docs/docs.md](https://vatio.ai/docs/docs.md) serves, and
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
login | logout              Authorize this machine in a browser, or revoke and forget it
doctor                      Node, config, workspace and token status

push                        Validate the workspace, then update preview
pull [--env NAME]           Write the deployed agent back into vatio.yml and tools/
publish                     Take preview live, once `vatio test` has tested it
diff [--env NAME]           What this directory would change
status                      Preview and live deployment state
rollback                    Restore the previous live deployment

chat "message" [--env NAME] [--new]
                            Talk to your own agent; the token is the identity
chat show [CHAT_ID] [--json]
                            The chat you are in, or any chat in the workspace, with its tool calls

flags                       Every open report from the inbox, for your coding agent to fix
test                        Test every report against preview, in the background
test --wait                 Wait for the report; exits 1 if a case fails
tools [--env NAME]          How each tool's backend has been answering

kb list|show|create|rm       Knowledge bases
kb write|cat|rm-entry        Entries, from a file or stdin

secrets list|set|rm          Credentials your tools read
keys list|create|origins|revoke  API keys: publishable (page, app) and secret (backend)
auth --new-key               Keypair that signs the visitor's JWT

whatsapp | instagram         Set up in the inbox; prints the link

docs [--save [PATH]]         The whole developer contract
config show|set|unset        base_url and token, per developer
```

`--env NAME` targets an environment: `preview`, the next version, or `live`,
what visitors talk to.

Run `npx @vatio-ai/cli help` for the whole surface, and see
[vatio.ai/docs](https://vatio.ai/docs) for the platform.

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
[changelog](https://vatio.ai/docs/changelog).
