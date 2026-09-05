# CHK-08 desktop check

[VERIFIED, local commands] The local desktop checks returned:

~~~text
$ command -v obsidian
exit 1

$ ls -ld /Applications/Obsidian.app
ls: /Applications/Obsidian.app: No such file or directory

$ pgrep -fl Obsidian
exit 1

$ agent-browser --version
agent-browser 0.25.3

$ osascript -e 'tell application "System Events" to get name of every process whose visible is true'
40:83: execution error: An error of type -10827 has occurred. (-10827)
~~~

[VERIFIED, agent-browser help] agent-browser describes browser commands such as open, click, snapshot, and screenshot. It does not provide a native Obsidian application control in the installed help. It was not connected to a browser or used to open a file.

[VERIFIED, generated-vault read] Only the generated vault under data/vault was read. Start.md contains the link [[FalconOS/Strategies/USDC-EURC]]. The strategy note links USDC, EURC, Solana, and Base notes. The inspected run note acdc0475-2c37-4d7c-9c35-75403f95efa3 is marked mode demo and Synthetic demonstration, and it contains the intended strategy link and an evidence SHA-256.

[INFERRED, desktop limit] No Obsidian desktop app or suitable native UI automation was available in this session. The file reads verify text and target-file presence only. They do not verify Obsidian rendering, graph resolution, or desktop behavior.

[INFERRED, CHK-08 status] The Obsidian desktop criterion remains open. No unrelated vault was opened, no plugin was installed, and no app security setting was changed. No power-loss claim is made.
