# vhs tape — records the interactive wizard: browse the plugin menu, list
# tracked packages, then update the outdated ones.
# Run with: vhs dev/wizard.tape   (or: pnpm screenshots:wizard)
#
# Uses dev/sandbox.sh --fake-brew, which seeds tracked formulas and shadows
# `brew` with a deterministic stand-in — so "update" is a real wizard flow
# but simulated package operations: nothing on the host machine changes and
# every render (local or CI) shows the same versions. The finished frame is
# also saved as a still (img/wizard-final.png) via Screenshot.

Output img/wizard.gif

Set Shell "zsh"
Set FontFamily "JetBrains Mono"
Set FontSize 13
Set Width 880
Set Height 760
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

# Boot the fake-brew sandbox off-camera — the viewer only sees the wizard.
Hide
Type "./apps/cli/dev/sandbox.sh -q --fake-brew"
Enter
Sleep 2s
Type "clear"
Enter
Sleep 500ms
Show

# Launch the wizard: splash + "Which package manager?" menu.
Type "macup"
Sleep 500ms
Enter
Sleep 2500ms

# Browse the menu, then settle on Homebrew → Formulas (the first row).
Down
Sleep 400ms
Down
Sleep 400ms
Up
Sleep 350ms
Up
Sleep 350ms
Enter
Sleep 1500ms

# "List tracked" — view the tracked packages and their status.
Enter
Sleep 3s

# "Update selectively" — pick the outdated packages and update them.
Down 4
Sleep 500ms
Enter
Sleep 2s
# clack's autocomplete-multiselect only treats space as "toggle" while in
# navigation mode (i.e. after an arrow key) — otherwise space is typed
# into the filter. So always arrow first, then toggle.
Down
Sleep 400ms
Space
Sleep 500ms
Up
Sleep 400ms
Space
Sleep 600ms
Enter
# The fake brew sleeps per upgrade so the N/M spinner reads on camera.
Sleep 5s

# Hold the finished frame, then save it as a standalone still. The trailing
# Sleep keeps the clean frame on screen while the Screenshot flushes.
Sleep 3s
Screenshot img/wizard-final.png
Sleep 1s

# Exit the wizard and the sandbox subshell off-camera.
Hide
Sleep 500ms
Escape
Sleep 300ms
Escape
Sleep 300ms
Type "exit"
Enter
