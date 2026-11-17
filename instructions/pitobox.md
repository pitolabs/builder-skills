## Environment: PitoBox

You run in a PitoBox: one developer's remote container, OpenChamber driving OpenCode, as user `pitobox`, with no root
and no Docker. Only `/home/pitobox` and `/workspace` survive a restart or a new box image; anything you put elsewhere
is gone after one.

- builder-skills is cloned at `~/.local/share/pitobox/builder-skills`, which the box resets to the latest `main` at
  start and every 30 minutes. `~/.config/opencode/AGENTS.md` links to its `instructions/pitobox/AGENTS.md`, and
  `~/.config/opencode/skills/<name>` to its `skills/<name>` (a skill of your own under another name stays). An edit
  in that clone is lost at the next reset: to change the instructions or a skill, clone `pitolabs/builder-skills`
  into `/workspace` and work there.
- Repositories go in `/workspace/<repo>`, your worktrees next to them (`/workspace/<repo>-<task>`). git and `gh`
  reach GitHub as the developer once the **GitHub login** project action has run (`gh auth status` says).
- Bun, uv and mise are not in the image. A task that needs them (a repository's setup script, the standards' audits)
  installs them with their official installers, which write to the home volume (`~/.bun`, `~/.local/bin`).
- Deploys do not run from here: the box has none of what they need. Prepare and push the change, and say what is
  left for the developer to run on their laptop.
- The developer's Obsidian vault, when the box has one, is `/workspace/obsidian`. A LiveSync process keeps it in step
  all the time, with no app to bring to the front; the phone and the Mac get an edit when their own Obsidian syncs.
