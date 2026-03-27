# tyme-mcp

An MCP (Model Context Protocol) server that connects AI assistants to [Tyme](https://www.tyme-app.com/), the macOS time tracking app. Control timers, manage projects and tasks, search time records, and generate reports — all through natural language.

## Features

- **Timer control** — Start, stop, and check running timers
- **Project & task management** — List, create, update, and delete projects and tasks
- **Time record search** — Query records by date range, project, task, type, and more
- **Reports** — Daily summaries and date-range reports grouped by project
- **Native macOS integration** — Communicates directly with Tyme via AppleScript/JXA. No API keys, no cloud dependency, works offline
- **22 tools** covering the full Tyme workflow

## Requirements

- macOS
- [Tyme 3](https://www.tyme-app.com/) installed and running
- [Bun](https://bun.sh/) runtime

## Setup

### 1. Install Bun (if not installed)

```bash
curl -fsSL https://bun.sh/install | bash
```

### 2. Configure your MCP client

#### Claude Code

```bash
claude mcp add tyme -- bunx tyme-mcp
```

Or add to your `.mcp.json`:

```json
{
  "mcpServers": {
    "tyme": {
      "command": "bunx",
      "args": ["tyme-mcp"]
    }
  }
}
```

#### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "tyme": {
      "command": "bunx",
      "args": ["tyme-mcp"]
    }
  }
}
```

### 4. Launch Tyme

Make sure Tyme is running before using the MCP server. The server communicates with Tyme through macOS scripting, so Tyme must be open.

## Tools

### Timer Operations

| Tool | Description |
|------|-------------|
| `start_timer` | Start a timer for a task |
| `stop_timer` | Stop a timer for a task |
| `get_running_timers` | List currently running timers |

### Data Retrieval

| Tool | Description |
|------|-------------|
| `list_categories` | List all categories |
| `list_projects` | List projects (optionally filtered by category) |
| `list_tasks` | List tasks in a project |
| `list_subtasks` | List subtasks of a task |
| `get_task_detail` | Get detailed task information |
| `get_selected_object` | Get the currently selected item in Tyme UI |
| `get_task_records` | Search time records by date range and filters |
| `get_record_detail` | Get detailed record information |

### CRUD Operations

| Tool | Description |
|------|-------------|
| `create_project` | Create a new project |
| `update_project` | Update project properties |
| `delete_project` | Delete a project |
| `create_task` | Create a new task |
| `update_task` | Update task properties |
| `delete_task` | Delete a task |
| `create_record` | Create a time record |
| `update_record` | Update a time record |
| `delete_record` | Delete a time record |

### Reports

| Tool | Description |
|------|-------------|
| `get_daily_summary` | Work summary for a specific day |
| `get_range_summary` | Work summary over a date range, grouped by project |

## Usage Examples

Once configured, you can interact with Tyme using natural language:

- "Show me my projects" — lists all Tyme projects
- "What timers are running?" — checks active timers
- "Start tracking time on task X" — starts a timer
- "How much did I work this week?" — generates a summary report
- "Create a new task called 'Design review' in project Y" — creates a task

## How It Works

```
AI Assistant → MCP Protocol → tyme-mcp → osascript (AppleScript/JXA) → Tyme.app
```

The server uses two scripting approaches:
- **JXA (JavaScript for Automation)** for read operations — returns structured JSON
- **AppleScript** for write operations — reliable object creation and manipulation

All user inputs are sanitized before interpolation into scripts to prevent injection.

## Development

```bash
# Run the server directly
bun run src/index.ts

# Watch mode
bun run dev
```

## Tech Stack

- [Bun](https://bun.sh/) — TypeScript runtime
- [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk) — MCP server SDK
- [Zod](https://zod.dev/) — Input validation
- AppleScript / JXA — macOS automation

## License

MIT
