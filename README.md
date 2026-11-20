# Gizlet

Gizlet Home lists app entry points. An app such as a future NES emulator owns its own game library. Gizlet will also host system features such as the Marketplace client and Wi-Fi settings. First-party apps can live in separate `gizlet/<app>` repositories.

The initial product deliverables, in order, are an R36S Linux SD image, a macOS desktop app, and a Windows desktop app. iOS, Android, and RTOS targets are planned for later and may use separate repositories. This prototype runs in a terminal on Linux and macOS.

## Build and run

Use Bazelisk or Bazel 9.2.0 and the host C toolchain (GCC on Linux or Xcode on macOS). On Linux, install BusyBox at `/bin/busybox`, for example with `sudo apt install busybox` on Ubuntu. On macOS, Terminal uses `/bin/sh`.

```sh
bazel build //targets/cc_binary:gizlet
bazel run //targets/cc_binary:gizlet
bazel test //tests:launcher_test --test_output=all
```

In a foreground terminal, type `terminal` to open an interactive shell. Type `exit` in the shell to return to Gizlet Home. Type `quit` or press Ctrl-D at Home to close Gizlet. On Linux, select a BusyBox executable at a different absolute path with `bazel run //targets/cc_binary:gizlet -- --busybox /absolute/path/to/busybox`.

The portable Home logic in [`launcher/`](launcher/) uses GizOS's public `libs/container/trie` library and PAL result codes to resolve exact selections into app actions. The POSIX adapter in [`targets/cc_binary/`](targets/cc_binary/) starts the shell with fixed arguments, waits for it, and restores terminal settings. The PTY test checks return to Home and verifies that the Linux shell process is the installed BusyBox executable.
