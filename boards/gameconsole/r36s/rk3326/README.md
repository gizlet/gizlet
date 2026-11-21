# R36S Panel 0 system card

This board targets the genuine RK3326 Game Console R36S-V12 (2023-08-18) with the original 640×480 ST7703 Panel 0. Check the original card's display DTB and the PCB marking together. Other displays and EE clones need their own board configuration. [Board and panel reference](https://github.com/southoz/dArkOSRE-R36/tree/3f372c85aa53a26b265c3dc0c2661ec0fae5faf0/files/BOOT/dtb/r36s/R36S-V12%202023-08-18%20Panel%200)

## Build the card

Use Bazel 9.2.0 on a case-sensitive Linux filesystem. On Ubuntu 24.04 ARM64 install the following packages. Ubuntu amd64 builders also need `gcc-aarch64-linux-gnu` and `libc6-dev-arm64-cross` for the kernel, U-Boot and BusyBox.

```sh
sudo apt-get install build-essential bc bison flex libssl-dev libelf-dev pkg-config xz-utils bzip2 patch \
    device-tree-compiler genimage dosfstools mtools squashfs-tools faketime fdisk u-boot-tools python3
bazel build --config=r36s //targets/sd_image/gameconsole/r36s:gizlet-r36s-panel0
```

The build runs as a regular user and writes `bazel-bin/targets/sd_image/gameconsole/r36s/gizlet-r36s-panel0.img`. The `r36s` configuration builds `//targets/cc_binary:gizlet` as a static AArch64 executable and installs those exact bytes in `/usr/bin/gizlet`. Its Home menu uses the public GizOS trie library.

The image target composes four public Rockchip rules from the pinned GizOS module to build Linux 6.12.17 and its DTB, legacy U-Boot 2017.09, the BusyBox 1.37.0 root filesystem and the raw card. Gizlet selects the RK3326 legacy rkbin inputs through GizOS and supplies its ordered board patches, [BL31 packer configuration](trust.ini), boot parameters, filesystem contents and TF1 layout. The native stages rebuild on each invocation to account for host tool changes. Identical host tools and declared inputs support byte-for-byte reconstruction. [Image target](../../../../targets/sd_image/gameconsole/r36s/BUILD.bazel) · [GizOS rules](https://github.com/GizClaw/gizos/blob/a587fa187b752d7dd67f13d0a04ae24819e3c01f/tools/bazel/native/rockchip/README.md) · [Pinned inputs and credits](../../../../third_party/r36s/README.md)

## TF1 layout and Home startup

Write the entire 96 MiB image to a spare microSD for **TF1/OS**. Preserve the original card. The board uses one fixed system slot on TF1. TF2/Game is optional and the system boots with TF1 alone. Sector sizes are 512 bytes. [Disk layout](sdcard.cfg) · [Boot command](boot.cmd)

| Start sector | Contents | Use |
| ---: | --- | --- |
| 0 | MBR with disk ID `36335030` | System card identity |
| 64 | Rockchip ID block, DDR init and miniloader | BootROM input |
| 16384 | Four `LOADER` copies | U-Boot |
| 24576 | Two `BL3X` copies | BL31 firmware |
| 32768 | Partition 1, 64 MiB FAT16, `GIZLETBOOT` | U-Boot loads `boot.scr`, `Image` and `r36s.dtb` from `mmc 1:1` |
| 163840 | Partition 2, 16 MiB allocation, SquashFS | Linux mounts `PARTUUID=36335030-02` on `/`, read-only |

`/usr/bin/gizlet` and `/bin/busybox` both live in that root. Init mounts `/proc`, `/sys` and writable tmpfs on `/run` and `/tmp`. Files in those tmpfs mounts last for the current boot. The Home menu works directly from the system card. [Init configuration](inittab) · [Early mounts](rcS)

BusyBox init starts Home on the LCD virtual terminal (`tty1`) and the active serial console (UART2 at 1500000 8N1 on the R36S). Type `terminal` to enter the packaged BusyBox shell and `exit` to return to Home. Exiting Home starts a fresh Home session. The board configures the OTG port for a USB keyboard using the RK817 VBUS switch. Keyboard enumeration, physical display, controls, UART and TF1 cold boot are hardware acceptance checks.

## Verify

Install `qemu-system-arm` to run the guest test. The image test reads the final card and checks the partition table, BL31 load addresses, full 4 MiB trust digest, USB supply wiring, root filesystem and packaged launcher. The guest test extracts `Image` from the FAT partition, attaches the complete card read-only to a Cortex-A35 QEMU `virt` machine, opens BusyBox from Home, runs a command, exits to Home and powers down. QEMU uses its own UART, device tree and virtio disk.

```sh
bazel test --config=r36s --test_output=all \
    //targets/sd_image/gameconsole/r36s:image_test \
    //targets/sd_image/gameconsole/r36s:boot_test
```
