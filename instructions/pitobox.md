## Environment: PitoBox

You run in a PitoBox: one developer's container at `https://<dev>.box.pitolabs.com`, OpenChamber driving OpenCode,
as user `pitobox` (uid 1000). No root, no Docker, no way into the VM it runs on or into other boxes. Only
`/home/pitobox` and `/workspace` are volumes (kept across restarts, backed up nightly); the rest of the filesystem
is reset whenever the box image is rebuilt.

- builder-skills is cloned at `~/.local/share/pitobox/builder-skills`, which the box resets to the latest `main` at
  start and every 30 minutes. `~/.config/opencode/AGENTS.md` links to its `instructions/pitobox/AGENTS.md`, and
  `~/.config/opencode/skills/<name>` to its `skills/<name>` (a skill of your own under another name stays). An edit
  in that clone is lost at the next reset: to change the instructions or a skill, clone `pitolabs/builder-skills`
  into `/workspace` and work there.
- Repositories go in `/workspace/<repo>`, your worktrees next to them (`/workspace/<repo>-<task>`). git and `gh`
  reach GitHub as the developer once the **GitHub login** project action has run (`gh auth status` says).
- Bun, uv and mise are not in the image. A task that needs them (a repository's setup script, the standards' audits)
  installs them with their official installers, which write to the home volume (`~/.bun`, `~/.local/bin`).
- There are no deploy secrets and no SSH keys to Pito Labs servers here: a deploy runs from the developer's laptop.
  Prepare and push the change, and say what is left to run there.
- The developer's Obsidian vault, when the box has one, is `/workspace/obsidian`. A LiveSync sidecar (pitovault)
  keeps it in step with CouchDB all the time, with no app to bring to the front; the phone and the Mac get an edit
  when their own Obsidian syncs.
