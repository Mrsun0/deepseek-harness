# Program console

Start the console program by passing the launch command below as the exact command argument of the bash tool on Linux or the pwsh tool on Windows. Set run_in_background to true so the tool returns while the process stays running. Do not use a PTY and do not change the command. After the tool returns, one Console binds to the new process when that process does not already have one.

launch-command: node -e "setInterval(() => {}, 1000000000)"
