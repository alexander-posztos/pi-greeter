# pi-greeter

A minimal startup greeter for the Pi coding agent, inspired by [`alpha-nvim`](https://github.com/goolord/alpha-nvim).

![pi-greeter screenshot](https://raw.githubusercontent.com/alexander-posztos/pi-greeter/main/images/screenshot.png)

## Install

```bash
pi install npm:pi-greeter
```

From a local checkout:

```bash
pi install /path/to/pi-greeter
```

## Usage

Once installed, the greeter shows on startup. From a running Pi session, use `/greeter` to open it again.

In the greeter, press `u` to update Pi with confirmation. pi-greeter also provides `/pi-update` so you can run the same update flow from a running session.

```text
/greeter       Open the greeter
/pi-update     Run pi update with confirmation
```

Greeter keys:

```text
n     New session
r     Prepare Pi's official /resume picker
c     Edit greeter config
g     Open lazygit for the current cwd
u     Run pi update after confirmation
q     Quit Pi
```

## Configuration

Configuration is loaded from `~/.pi-greeter.json` by default. Press `c` in the greeter to edit it. You can override the path with `PI_GREETER_CONFIG`.

```json
{
  "showOnStartup": true,
  "icons": true,
  "showCwd": false,
  "logo": "pi"
}
```

See `pi-greeter.example.json` for a starter config.

`showOnStartup` can be `true`, `false`, or `"fresh"`. Set `icons` to `false` for an ASCII fallback when Nerd Font icons are unavailable. Set `showCwd` to `true` if you want the greeter to show the current working directory. Set `logo` to `"pi"`, `"text"`, or `"compact"`.

## Notes

- Nerd Font recommended for icons.
- The current working directory is hidden by default to avoid exposing local paths in screenshots.
- Config and lazygit open in a new tmux window when Pi is running inside tmux. Outside tmux, the greeter shows the command to run manually.
- Pi extensions run with full system access. Review code before installing third-party packages.
