# routerlm

LobakAI is a local AI gateway and dashboard. `routerlm` installs and starts it.

## Install and start

```bash
npm install -g routerlm
routerlm

# Or run it without installing
npx routerlm
```

The dashboard opens at `http://localhost:20130/dashboard`.

The OpenAI-compatible API listens at `http://localhost:20129/v1`. The dashboard port forwards `/v1` too.

Bun ships with the package. You only need Node.js 18 or later and npm.

## Options

```bash
routerlm                    # Start with default settings
routerlm --port 8080        # Dashboard port (default 20130)
routerlm --host 127.0.0.1   # Local-only (default 0.0.0.0)
routerlm --no-browser       # Don't open the browser
routerlm --log              # Show server logs
routerlm --skip-update      # Skip the update check
routerlm --help             # Show all options
```

Set `BACKEND_PORT` to move the API off port 20129.

The default host is `0.0.0.0`, so other machines on your network can reach the server. Change the dashboard password before you share the address.

## Connect CLI tools to a remote server

`routerlm connect` points the CLI tools on this machine at a LobakAI server that runs somewhere else. It starts no local server.

```bash
npx routerlm connect http://<server-host>:20130                       # pick tools interactively
npx routerlm connect http://<server-host>:20130 --tools claude,codex  # or choose up front
npx routerlm connect --reset --tools claude,codex                     # undo
```

The command logs in with the dashboard password. It reuses or creates an API key named `cli-<hostname>`. Then it writes each tool's config and backs up the original once as `*.bak-routerlm`.

Supported tools: `claude`, `codex`, `opencode`, `droid`, `crush`, `kilo`, `cline`, `pi`, `omp`, or `all`.

| Option | Purpose |
|---|---|
| `--password <pw>` | Dashboard password, or set `ROUTERLM_PASSWORD`. You get a prompt when you omit it. |
| `--save` | Save the password for this server to `~/.lobakai/connect.env` (plain text, mode 600). |
| `--api-key <key>` | Use this key and skip the login. Pass model flags too, because the server's models need a login. |
| `--key-name <name>` | API key name to reuse or create. The default is `cli-<hostname>`. |
| `--model <model>` | Model for every non-Claude tool. |
| `--fable`, `--opus`, `--sonnet`, `--haiku` | Override one Claude Code tier. |
| `--print-env` | Also print `OPENAI_BASE_URL` and `OPENAI_API_KEY`. |
| `--reset` | Remove the LobakAI settings from the selected tools. |

Run `routerlm connect --help` for details.

Over plain `http://`, the password and API key travel unencrypted. Use a trusted LAN or VPN, or put HTTPS in front.

## Check the current config

`routerlm show` prints the base URL, masked API key, and models each tool uses. It reads local files only.

```bash
routerlm show                 # every supported tool
routerlm show claude codex    # selected tools
routerlm show claude --json   # machine-readable
```

## Data location

- macOS and Linux: `~/.lobakai/db/data.sqlite`
- Windows: `%APPDATA%/lobakai/db/data.sqlite`

An existing `~/.9router` folder keeps working when `~/.lobakai` does not exist. Set `DATA_DIR` to use another folder.

## Acknowledgments

The `routerlm` launcher and the `connect` and `show` commands are ported from the [9router](https://github.com/decolua/9router) CLI (MIT).

## License

MIT
