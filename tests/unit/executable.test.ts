import assert from "node:assert/strict";
import { test } from "node:test";
import { EXECUTABLE_HEAD_BYTES, executableProblem } from "../../src/check.ts";

const head = () => new Uint8Array(EXECUTABLE_HEAD_BYTES);

function elf(machine: number, type = 2): Uint8Array {
  const b = head();
  b.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]);
  const v = new DataView(b.buffer);
  v.setUint16(16, type, true);
  v.setUint16(18, machine, true);
  return b;
}

function macho(cpu: number, filetype = 2): Uint8Array {
  const b = head();
  const v = new DataView(b.buffer);
  v.setUint32(0, 0xfeedfacf, true);
  v.setUint32(4, cpu, true);
  v.setUint32(12, filetype, true);
  return b;
}

function fat(...cpus: number[]): Uint8Array {
  const b = head();
  const v = new DataView(b.buffer);
  v.setUint32(0, 0xcafebabe, false);
  v.setUint32(4, cpus.length, false);
  cpus.forEach((cpu, i) => v.setUint32(8 + i * 20, cpu, false));
  return b;
}

function pe(machine: number, characteristics = 0x0022, at = 0x80): Uint8Array {
  const b = head();
  const v = new DataView(b.buffer);
  b.set([0x4d, 0x5a]);
  v.setUint32(0x3c, at, true);
  v.setUint32(at, 0x00004550, true);
  v.setUint16(at + 4, machine, true);
  v.setUint16(at + 22, characteristics, true);
  return b;
}

const ARM64 = 0x0100000c;
const X86_64 = 0x01000007;

test("ELF: machine and type", () => {
  assert.equal(executableProblem("aarch64-unknown-linux-gnu", elf(183)), null);
  assert.equal(executableProblem("aarch64-unknown-linux-gnu", elf(183, 3)), null); // PIE
  assert.match(executableProblem("aarch64-unknown-linux-gnu", elf(62))!, /ELF machine 62/);
  assert.match(executableProblem("aarch64-unknown-linux-gnu", elf(183, 1))!, /not an executable/); // relocatable
  assert.match(executableProblem("aarch64-unknown-linux-gnu", new Uint8Array([0x4d, 0x5a]))!, /not an ELF/);
});

test("Mach-O: CPU type, file type and universal slices", () => {
  assert.equal(executableProblem("aarch64-apple-darwin", macho(ARM64)), null);
  assert.equal(executableProblem("x86_64-apple-darwin", macho(X86_64)), null);
  assert.match(executableProblem("x86_64-apple-darwin", macho(ARM64))!, /not x86_64/);
  assert.match(executableProblem("aarch64-apple-darwin", macho(ARM64, 6))!, /not an executable/); // dylib
  assert.equal(executableProblem("x86_64-apple-darwin", fat(ARM64, X86_64)), null);
  assert.match(executableProblem("x86_64-apple-darwin", fat(ARM64))!, /no x86_64 slice/);
  const javaClass = fat();
  new DataView(javaClass.buffer).setUint32(4, 0x00000034, false);
  assert.match(executableProblem("aarch64-apple-darwin", javaClass)!, /not a Mach-O/);
  assert.match(executableProblem("aarch64-apple-darwin", new Uint8Array([0xcf, 0xfa, 0xed, 0xfe]))!, /not a Mach-O/);
});

test("PE: header, machine and executable image", () => {
  assert.equal(executableProblem("x86_64-pc-windows-msvc", pe(0x8664)), null);
  assert.equal(executableProblem("aarch64-pc-windows-msvc", pe(0xaa64)), null);
  assert.match(executableProblem("x86_64-pc-windows-msvc", pe(0xaa64))!, /machine 0xaa64, not x86_64/);
  assert.match(executableProblem("x86_64-pc-windows-msvc", pe(0x8664, 0x2000))!, /not an executable image/);
  assert.match(executableProblem("x86_64-pc-windows-msvc", new Uint8Array([0x4d, 0x5a]))!, /not a Windows executable/);
  const far = pe(0x8664);
  new DataView(far.buffer).setUint32(0x3c, EXECUTABLE_HEAD_BYTES - 8, true); // header past the bytes read
  assert.match(executableProblem("x86_64-pc-windows-msvc", far)!, /no PE header/);
});
