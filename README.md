# Gizlet

Gizlet Home lists app entry points. An app such as a future NES emulator owns its own game library. Gizlet will also host system features such as the Marketplace client and Wi-Fi settings. First-party apps can live in separate `gizlet/<app>` repositories.

The initial product deliverables, in order, are an R36S Linux SD image, a macOS desktop app, and a Windows desktop app. iOS, Android, and RTOS targets are planned for later and may use separate repositories. This prototype runs in a terminal on Linux and macOS.

## R36S system card

Build the Gizlet TF1 image for the RK3326 R36S-V12 with original Panel 0 on Linux. It boots straight to Gizlet Home and includes BusyBox Terminal. The board guide describes the card layout, build prerequisites and QEMU tests. [R36S board guide](boards/gameconsole/r36s/rk3326/README.md)

```sh
bazel build --config=r36s //targets/sd_image/gameconsole/r36s:gizlet-r36s-panel0
```

## Build and run

Use Bazelisk or Bazel 9.2.0 and the host C toolchain (GCC on Linux or Xcode on macOS). On Linux, install BusyBox at `/bin/busybox`, for example with `sudo apt install busybox` on Ubuntu. On macOS, Terminal uses `/bin/sh`.

```sh
bazel build //targets/cc_binary:gizlet
bazel run //targets/cc_binary:gizlet
bazel test //tests:launcher_test --test_output=all
```

In a foreground terminal, type `terminal` to open an interactive shell. Type `exit` in the shell to return to Gizlet Home. Type `quit` or press Ctrl-D at Home to close Gizlet. On Linux, select a BusyBox executable at a different absolute path with `bazel run //targets/cc_binary:gizlet -- --busybox /absolute/path/to/busybox`.

If the Terminal shell suspends itself while Gizlet is a job of an outer interactive shell, the outer shell regains the terminal. Run `fg` there to resume Gizlet and the same Terminal shell. A direct foreground launch without an outer job closes the suspended shell and returns to Gizlet Home.

Gizlet's application layer uses GizOS PAL contracts and portable libraries. Home resolves `terminal` and `quit` with the public `h2_trie_build` and `h2_trie_handle` APIs. It uses `h2_pal_result_t`, `H2_PAL_OK` and `H2_PAL_ERR_NOT_FOUND` to handle dispatch results. The prototype's POSIX terminal adapter starts the selected shell with `posix_spawn`, waits with `waitpid`, and restores terminal settings and foreground ownership. The PTY test exercises the return to Home and verifies the BusyBox process on Linux. GizOS's Rockchip Bazel rules run on the build host to produce the system card. [Home](launcher/src/home.c) · [Terminal adapter](targets/cc_binary/terminal.c) · [Image target](targets/sd_image/gameconsole/r36s/BUILD.bazel)
