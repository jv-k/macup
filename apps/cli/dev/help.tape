# vhs tape — renders macup --help as a single PNG (macOS-window look).
# Run with: vhs dev/help.tape   (or: pnpm screenshots:help)
#
# vhs emits a full animated GIF for any tape — we don't use it here, so it
# lands in tmp/help.gif (gitignored). The single PNG we care about comes
# from the `Screenshot` directive at the bottom.

Output img/tmp/help.gif

Set Shell "zsh"
Set FontFamily "JetBrains Mono"
Set FontSize 15
Set Width 1000
# Tall enough to hold the whole --help — logo through EXAMPLES — in one frame,
# and no taller. Three constraints: (1) vhs' Screenshot captures the viewport,
# so a short height scrolls the typed command + header logo off the top;
# (2) help opens the in-process pager (src/ui/pager.ts) when it has more lines
# than the terminal has rows (~83 lines today), so the height must also keep
# rows > lines or the screenshot catches the pager's status bar; (3) extra rows
# render as blank background at the bottom of the PNG, so don't overshoot —
# after editing the help text, re-render and trim/grow this until the frame is
# snug. This clears all three.
Set Height 1660
# Monokai Pro palette with a Carbon (#191816) background for the terminal itself.
Set Theme { "background": "#191816", "foreground": "#FCFCFA", "cursor": "#FCFCFA", "black": "#2D2A2E", "red": "#FF6188", "green": "#A9DC76", "yellow": "#FFD866", "blue": "#FC9867", "magenta": "#AB9DF2", "cyan": "#78DCE8", "white": "#FCFCFA", "brightBlack": "#727072", "brightRed": "#FF6188", "brightGreen": "#A9DC76", "brightYellow": "#FFD866", "brightBlue": "#FC9867", "brightMagenta": "#AB9DF2", "brightCyan": "#78DCE8", "brightWhite": "#FCFCFA", "selection": "#5B595C" }
Set Padding 12
Set Margin 8
Set MarginFill ""
Set BorderRadius 10
Set WindowBar Colorful
Set WindowBarSize 40
Set TypingSpeed 40ms

# Boot the sandbox off-camera so `macup` is on PATH via the shim and the
# subshell has a clean `$ ` prompt instead of the user's custom PS1.
Hide
Type "./apps/cli/dev/sandbox.sh -q"
Enter
Sleep 2s
Type "clear"
Enter
Sleep 500ms
Show

Type "macup --help"
Sleep 400ms
Enter
Sleep 2500ms

Screenshot img/screenshot.png

Sleep 500ms
