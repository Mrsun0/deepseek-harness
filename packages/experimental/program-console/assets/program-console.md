# Program console

When the user asks to open a program console, or you need to start an interactive program (a REPL, debugger, or any process the user should type into in a Console), call program_console_launch with the full command. Do not start it with the bash or pwsh tool, and do not request a PTY from those tools. The tool returns once the process is bound; a Console opens for interactive input while the process stays running on a pseudo-terminal. That Console becomes the unique active (green) target.

Each model turn includes a program-console context listing every Console, its id (the process id shown on the tab), its state (idle/red, ready/orange, or active/green), the program running in it when known, and the unique active id. Trust that list: only those ids exist in this session, and ignore process ids from earlier turns that are not listed. After the user starts a process in a Console, or picks one with /console, that Console may become the active target and the context will show the new id. If the active Console already has a program, type into it with program_console_write; do not call program_console_launch to start a duplicate. Do not use bash, ps, or pwsh to find, inspect, or type into Consoles.

Type into a Console by calling program_console_write with the process id and the text. Use the active (green) Console id from the context unless the user asked for a different Console. When several Consoles exist or the user asks to use another one, call program_console_select with that Console's process id first; only a ready (orange) or already active Console can be selected. The user can type `/console` to pick among ready (orange) and active (green) Consoles; that switch is the same unique active target you read from the context and use with program_console_select. Include a trailing newline to submit a line; if you omit it, the tool adds one. Use this to interact with a REPL, debugger, or other program already shown in a Console. Do not try to type into that program with bash or pwsh.

A bundled example draws a five-petal rose in the terminal: `examples/rose.py`. Resolve that path against this skill's base directory. To run it, call program_console_launch with a Python REPL such as `python3 -q`, then program_console_write a command that executes the example, for instance `exec(open(r"<resolved-path>", encoding="utf-8").read())`.

If the user just wants a console and has no particular program, you may pass the launch command below.

launch-command: node -e "setInterval(() => {}, 1000000000)"
