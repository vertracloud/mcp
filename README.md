# @vertracloud/mcp

Official MCP server for [Vertra Cloud](https://vertracloud.app): gives your AI assistant (Claude, Cursor, VS Code, n8n) the tools to deploy applications, read logs, create databases and restore snapshots — on your own account, with your own API key.

[Quick start](#quick-start) · [Connect from claude.ai](#connect-from-claudeai) · [Tools](#tools) · [Prompt ideas](#prompt-ideas) · [Common issues](#common-issues)

## Quick start

Prerequisite: **Node 18 or newer**.

1. In the dashboard, go to **Settings → API keys**, create a key and check the scopes the assistant will need (start with the read-only ones).
2. Copy the key — it's shown only once.
3. Configure your client:

**Claude Code**

```bash
claude mcp add vertracloud -e VERTRA_API_KEY=your_key -- npx -y @vertracloud/mcp
```

**Claude Desktop** (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "vertracloud": {
      "command": "npx",
      "args": ["-y", "@vertracloud/mcp"],
      "env": { "VERTRA_API_KEY": "your_key" }
    }
  }
}
```

**Cursor** (`.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "vertracloud": {
      "command": "npx",
      "args": ["-y", "@vertracloud/mcp"],
      "env": { "VERTRA_API_KEY": "your_key" }
    }
  }
}
```

**VS Code** (`.vscode/mcp.json`)

```json
{
  "servers": {
    "vertracloud": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@vertracloud/mcp"],
      "env": { "VERTRA_API_KEY": "your_key" }
    }
  }
}
```

Restart the client and ask something like "list my apps on Vertra".

## Connect from claude.ai

In the browser there's nothing to install:

1. Open **Settings → Connectors → Add custom connector**.
2. Enter the URL `https://mcp.vertracloud.app/mcp`.
3. Click **Connect** and sign in to your Vertra account.
4. Check the scopes you want to grant and confirm.

Tools marked "local only" in the table below don't show up here: they read and write files on your computer, which only makes sense in Claude Desktop, Claude Code or Cursor.

## Tools

Folders and favorites are preferences persisted on the server: tools with `personal` change the account's own organization, and tools with `workspace` change only the user's organization within that workspace. They organize applications and databases, with no relation to Flow's groups, layout or local storage.

<!-- tools:start -->

#### Documentation

| tool | what it does | scope | local only |
|---|---|---|---|
| `get_docs` | Vertra Cloud's public knowledge base: plans, prices, limits, supported languages and error codes. Consult it before stating any number. `section` trims an excerpt by title. | — |  |

#### Applications

| tool | what it does | scope | local only |
|---|---|---|---|
| `list_apps` | Lists the account's applications with the current status of each. | `apps:read` |  |
| `get_app` | Details of an application: name, memory, runtime, main file, publication. | `apps:read` |  |
| `get_app_status` | Live status (CPU, RAM, uptime) of an application; without `id`, of all of them. | `apps:read` |  |
| `get_logs` | Last lines of the application's log (snapshot, not real time). `tail` trims the last N lines of what the API returned. | `apps:read` |  |
| `get_metrics` | History of CPU, RAM, storage and network usage of the application. | `apps:read` |  |
| `list_runtimes` | Languages and versions the platform accepts. | `apps:read` |  |
| `start_app` | Turns the application on. | `apps:write` |  |
| `restart_app` | Restarts the application. `reinstall_dependencies` reinstalls dependencies from scratch (ignoring the install cache); `force_build` runs the build command again even without a code change. Both count as a deploy against the plan's hourly limit. | `apps:write` |  |
| `stop_app` | Turns the application off. | `apps:write` |  |
| `create_app` | Creates an application from a folder on the computer: compresses the folder (ignoring node_modules, .git and whatever is in .vertraignore) and uploads it. | `apps:write` | yes |
| `deploy_app` | Uploads a folder from the computer to an existing application (new deploy), using the same compression criteria as `create_app`. | `apps:files` | yes |
| `update_app_config` | Changes the application's configuration: name, memory, main file, runtime version, start command. | `apps:write` |  |
| `download_app` | Downloads the application's files as a zip and writes it to the given path. | `apps:read` | yes |
| `delete_app` | Permanently deletes the application, along with its files and configuration. | `apps:delete` |  |

#### Deploys

| tool | what it does | scope | local only |
|---|---|---|---|
| `list_deploys` | The application's deploy history. | `apps:read` |  |
| `get_deploy_webhook` | The application's automatic-deploy webhook URL. | `apps:read` |  |
| `create_deploy_webhook` | Creates (or renews) the application's automatic-deploy webhook, from an already connected GitHub repository. | `apps:write` |  |
| `delete_deploy_webhook` | Removes the automatic-deploy webhook; whoever was using the URL stops being able to deploy. | `apps:write` |  |

#### Environment variables

| tool | what it does | scope | local only |
|---|---|---|---|
| `list_envs` | Lists the NAMES of the application's environment variables. The value is never returned — no tool reads a variable's value. | `apps:envs` |  |
| `set_env` | Creates or overwrites an application environment variable. The response confirms the key, without echoing the value. | `apps:envs` |  |
| `delete_env` | Deletes an environment variable. Use the variable `id` returned by `list_envs`. | `apps:envs` |  |

#### Files

| tool | what it does | scope | local only |
|---|---|---|---|
| `list_files` | Lists the files and folders of a directory in the application. | `apps:files` |  |
| `get_file_tree` | The application's full file tree. | `apps:files` |  |
| `read_file` | Reads a file from the application. Text comes back readable; binary comes back as base64 with `encoding: "base64"`. | `apps:files` |  |
| `write_file` | Writes text content to a file in the application, creating it if it doesn't exist. | `apps:files` |  |
| `move_file` | Moves or renames a file inside the application. | `apps:files` |  |
| `upload_files` | Uploads files from the computer to a folder in the application. | `apps:files` | yes |
| `delete_file` | Deletes a file or folder from the application. | `apps:files` |  |

#### Network and domains

| tool | what it does | scope | local only |
|---|---|---|---|
| `get_network` | The application's custom domain and DNS records, in a single response. | `apps:read` |  |
| `set_subdomain` | Changes the application's public subdomain. Who is allowed to pick the name is determined by the plan. | `apps:write` |  |
| `publish_app` | Publishes the application on the web (public subdomain). | `apps:write` |  |
| `unpublish_app` | Takes the application off the web; the public address stops responding. | `apps:write` |  |
| `set_custom_domain` | Points a custom domain to the application. | `apps:write` |  |
| `remove_custom_domain` | Removes the application's custom domain; whoever accessed it through that domain stops reaching it. | `apps:write` |  |
| `purge_cache` | Clears the application's edge cache. | `apps:write` |  |

#### Databases

| tool | what it does | scope | local only |
|---|---|---|---|
| `list_databases` | Lists the account's databases with the status of each. | `databases:read` |  |
| `get_database` | Details of a database: engine, name, memory, address and port. | `databases:read` |  |
| `get_database_status` | Live status (CPU, RAM, disk, uptime) of a database; without `id`, of all of them. | `databases:read` |  |
| `get_database_metrics` | History of CPU, RAM, storage and network usage of the database. | `databases:read` |  |
| `create_database` | Creates a managed database. | `databases:write` |  |
| `update_database` | Changes the database's name, description or memory. | `databases:write` |  |
| `start_database` | Turns the database on. | `databases:write` |  |
| `stop_database` | Turns the database off. | `databases:write` |  |
| `reset_database` | DELETES ALL DATA in the database and leaves it empty. There is no way to undo this without a snapshot. | `databases:write` |  |
| `delete_database` | Permanently deletes the database, along with the data inside it. | `databases:delete` |  |
| `get_connection_info` | Data to connect to the database: address, port, engine, CA certificate in PEM and, when the account has one, a ready-made connection string. This server does not run queries — you're the one who connects. | `databases:credentials` |  |
| `reset_credentials` | Generates a new password for the database and returns it. Anyone connected with the old password gets disconnected. | `databases:credentials` |  |
| `reset_certificate` | Issues a new certificate for the database. Anyone using the old certificate stops being able to connect. | `databases:credentials` |  |

#### Snapshots

| tool | what it does | scope | local only |
|---|---|---|---|
| `list_snapshots` | Snapshots of a resource; without `resource_id`, snapshots of every resource of that type. | `snapshots:read` |  |
| `create_snapshot` | Takes a snapshot of the resource. Counts against the plan's snapshot quota. | `snapshots:write` |  |
| `restore_snapshot` | Restores a snapshot OVER the resource: the current content is replaced. | `snapshots:write` |  |
| `download_snapshot` | Downloads a snapshot and writes it to the given path on the computer. | `snapshots:read` | yes |

#### Account

| tool | what it does | scope | local only |
|---|---|---|---|
| `get_profile` | Account profile: plan, allocated memory, limits and usage. | `account:read` |  |
| `update_profile` | Changes the account's display name or language. | `account:write` |  |
| `list_sessions` | Open login sessions on the account (no IP or location). | `account:read` |  |
| `create_personal_folder` | Creates a personal folder to organize applications and databases. | `account:write` |  |
| `update_personal_folder` | Renames, recolors or reorders a personal folder. | `account:write` |  |
| `delete_personal_folder` | Deletes a personal folder; the resources inside it are not deleted. | `account:write` |  |
| `add_personal_resource_to_folder` | Puts an application or database into a personal folder. | `account:write` |  |
| `remove_personal_resource_from_folder` | Removes an application or database from a personal folder, without deleting the resource. | `account:write` |  |
| `favorite_personal_resource` | Adds an application or database to the personal favorites. | `account:write` |  |
| `unfavorite_personal_resource` | Removes an application or database from the personal favorites. | `account:write` |  |

#### Workspaces

| tool | what it does | scope | local only |
|---|---|---|---|
| `create_workspace_folder` | Creates a workspace folder to organize applications and databases. | `workspaces:write` |  |
| `update_workspace_folder` | Renames, recolors or reorders a workspace folder. | `workspaces:write` |  |
| `delete_workspace_folder` | Deletes a workspace folder; the resources inside it are not deleted. | `workspaces:write` |  |
| `add_workspace_resource_to_folder` | Puts an application or database into a workspace folder. | `workspaces:write` |  |
| `remove_workspace_resource_from_folder` | Removes an application or database from a workspace folder, without deleting the resource. | `workspaces:write` |  |
| `favorite_workspace_resource` | Adds an application or database to the workspace favorites. | `workspaces:write` |  |
| `unfavorite_workspace_resource` | Removes an application or database from the workspace favorites. | `workspaces:write` |  |
| `list_workspaces` | Workspaces the account is a member of. | `workspaces:read` |  |
| `get_workspace` | Details of a workspace. | `workspaces:read` |  |
| `create_workspace` | Creates a workspace. | `workspaces:write` |  |
| `update_workspace` | Changes the workspace's name or description. | `workspaces:write` |  |
| `add_app_to_workspace` | Moves an application into the workspace. | `workspaces:write` |  |
| `remove_app_from_workspace` | Takes an application out of the workspace and returns it to the owning account. | `workspaces:write` |  |
| `add_database_to_workspace` | Moves a database into the workspace. | `workspaces:write` |  |
| `remove_database_from_workspace` | Takes a database out of the workspace and returns it to the owning account. | `workspaces:write` |  |
| `list_members` | The workspace's members and each one's role. | `workspaces:read` |  |
| `update_member` | Changes a workspace member's role. | `workspaces:write` |  |
| `remove_member` | Removes a member from the workspace; they lose access immediately. | `workspaces:write` |  |
| `list_roles` | The workspace's roles and each one's permissions. | `workspaces:read` |  |
| `create_role` | Creates a role in the workspace. | `workspaces:write` |  |
| `update_role` | Changes a workspace role's name or permissions. | `workspaces:write` |  |
| `delete_role` | Deletes a role from the workspace; whoever had it loses those permissions. | `workspaces:write` |  |
| `delete_workspace` | Deletes the workspace (owner only). Members, roles, invites and links disappear; apps and databases go back to the owning account. This cannot be undone. | `workspaces:delete` |  |
| `list_workspace_invites` | The workspace's invites (pending and past). Creating an invite is dashboard-only. | `workspaces:invites` |  |
| `revoke_workspace_invite` | Revokes a pending workspace invite; the link or email stops working. | `workspaces:invites` |  |
| `preview_workspace_invite` | Shows which workspace and role an invite leads to, before accepting it. | `workspaces:invites` |  |
| `accept_workspace_invite` | Accepts an invite and joins the workspace with the account that owns the key. An invite sent by email only works for that account's email. | `workspaces:invites` |  |
| `decline_workspace_invite` | Declines an invite without joining the workspace; the invite stops being valid. | `workspaces:invites` |  |
| `list_action_requests` | The workspace's action requests (delete app/database, create/restore snapshot). Approving or rejecting is dashboard-only. | `workspaces:read` |  |
| `create_action_request` | Asks whoever has the permission to carry out an action the account can't do on its own. Nothing runs until a person approves it in the dashboard. | `workspaces:write` |  |

#### Billing

| tool | what it does | scope | local only |
|---|---|---|---|
| `list_plans` | Plans and prices, straight from the public knowledge base (not from a route). | — |  |
| `create_order` | Creates a plan subscription order and returns the final price (with coupon discount, if any) and the `order_id`. | `billing:write` |  |
| `get_pix` | Generates the order's PIX payment and returns the copy-and-paste code and the QR Code. THE PERSON PAYS, in their banking app — the agent never pays anything. | `billing:write` |  |
| `get_order_status` | Status of an order; poll it periodically until it turns paid. | `billing:read` |  |
| `list_orders` | The account's orders. | `billing:read` |  |
| `redeem_code` | Redeems a promotional code on the account. | `redeem:write` |  |

<!-- tools:end -->

## Prompt ideas

- "Deploy this folder as a Node app called `support-bot`, with 512 MB."
- "Why did `orders-api` go down? Show me the last 200 lines of the log."
- "Create a 1 GB Postgres and put its URL in `orders-api`'s env."
- "Restore yesterday's snapshot of `support-bot`."
- "Buy 3 months of Pro with the coupon `LAUNCH`."
- "Read `orders-api`'s log, fix it in my checkout code, and deploy."

## Security

Tools that read or write files on your computer only operate **inside the folder the server was started in**. If your client starts the server at the system root or your user folder, point it at the project folder with `VERTRA_MCP_ROOT` (alongside `VERTRA_API_KEY`, in the configuration's `env`) — files outside that folder, and credential folders like `.ssh` and `.aws`, are rejected even if the assistant asks for them.

This server only talks to the Vertra Cloud public API, always with your key — it has no permissions of its own. `list_envs` returns only the NAMES of environment variables: the value never leaves the server, because everything a tool returns enters the assistant's history. The key is the boundary of what the agent can do: grant only the scopes you need, and revoke the key in the dashboard when you're done.

## Common issues

| what shows up | what it means | what to do |
|---|---|---|
| `NOT_AUTHENTICATED` | key missing, wrong, or revoked | check `VERTRA_API_KEY` in your client's configuration |
| `API_KEY_SCOPE_DENIED` | the key doesn't have that tool's scope | create a new key with the scope the table indicates |
| `RATE_LIMIT_EXCEEDED` | the route's request limit was hit | wait the `retry_after` seconds and try again |
| the upload tool doesn't show up | you're on the browser connector | uploading files only works in local mode (Claude Desktop, Claude Code, Cursor) |
| `PATH_OUTSIDE_ROOT` or `ROOT_TOO_BROAD` | the file is outside the allowed folder | set `VERTRA_MCP_ROOT` to the project folder |
| `DEST_EXISTS` | a file already exists at that path | choose another name; nothing gets overwritten |
| the server won't start | Node below 18 | update Node |

## Contributing and license

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). License [MIT](LICENSE).
