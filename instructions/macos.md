## Environment: macOS laptop

You run on a developer's Mac. Deploys run from here: each repository's own `AGENTS.md` says how and with what.

- builder-skills is cloned at `~/pitolabs/builder-skills`. `~/.config/opencode/AGENTS.md` and `~/.claude/CLAUDE.md`
  link to its `instructions/macos/AGENTS.md`, and `~/.config/opencode/skills/<name>` to its `skills/<name>`. Nobody
  edits that clone: it changes only by `git -C ~/pitolabs/builder-skills pull --ff-only`, which you may run to pick up
  what was pushed.
- Repositories are cloned in `~/pitolabs/<repo>`, so your worktrees sit next to them (`~/pitolabs/<repo>-<task>`).
- Obsidian on a Mac syncs only when its window gets focus: a file changed or deleted in the vault by a shell or
  another editor stays local until then, and changes from other devices or servers arrive only then too. After
  editing a vault outside Obsidian, bring it to the front (`open -a Obsidian`), then check that the other copy changed.
