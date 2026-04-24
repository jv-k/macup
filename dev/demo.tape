# vhs tape — records a realistic macup run against a throwaway config.
# Run with: vhs dev/demo.tape   (or: pnpm screenshots:demo)
#
# Uses dev/sandbox.sh, which seeds a temp MACUP_CONFIG and puts a `macup`
# shim on PATH pointing at dist/cli.mjs. The sandbox boot is kept off-screen
# (Hide/Show) so the viewer only sees macup's output.

Output img/demo.gif

Set Shell "zsh"
Set FontFamily "JetBrains Mono"
Set FontSize 13
Set Width 820
Set Height 620
Set Framerate 24
# Monokai Pro palette with a Carbon (#191816) background for the terminal itself.
Set Theme { "background": "#191816", "foreground": "#FCFCFA", "cursor": "#FCFCFA", "black": "#2D2A2E", "red": "#FF6188", "green": "#A9DC76", "yellow": "#FFD866", "blue": "#FC9867", "magenta": "#AB9DF2", "cyan": "#78DCE8", "white": "#FCFCFA", "brightBlack": "#727072", "brightRed": "#FF6188", "brightGreen": "#A9DC76", "brightYellow": "#FFD866", "brightBlue": "#FC9867", "brightMagenta": "#AB9DF2", "brightCyan": "#78DCE8", "brightWhite": "#FCFCFA", "selection": "#5B595C" }
Set Padding 24
Set Margin 20
Set MarginFill ""
Set BorderRadius 10
Set WindowBar Colorful
Set WindowBarSize 40
Set TypingSpeed 45ms
Set PlaybackSpeed 1.0

# Boot the sandbox off-camera — we only want the macup output on screen.
Hide
Type "./dev/sandbox.sh -q"
Enter
Sleep 2s
Type "clear"
Enter
Sleep 500ms
Show

Type "macup --help"
Sleep 300ms
Enter
Sleep 2500ms

Type "clear"
Enter
Sleep 300ms

Type "macup --plugins"
Sleep 200ms
Enter
Sleep 1500ms

Type "macup brew add git curl jq"
Sleep 200ms
Enter
Sleep 1200ms

Type "macup npm pin typescript 5.3.3"
Sleep 200ms
Enter
Sleep 1200ms

Type "macup --config"
Sleep 200ms
Enter
Sleep 2500ms
