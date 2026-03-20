import fs from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { createReadStream, type ReadStream } from "node:fs";
import type { Dirent, Stats } from "node:fs";

/**
 * Abstraction over filesystem and process operations.
 * Default implementation uses local Node.js APIs.
 * Replace with SSH/Docker/cloud implementations for remote execution.
 */
export interface ToolOperations {
  /** Read a file's contents as UTF-8 string. */
  readFile(path: string): Promise<string>;

  /** Write content to a file. Creates parent directories if needed. */
  writeFile(path: string, content: string): Promise<void>;

  /** Get file/directory stats. */
  stat(path: string): Promise<Stats>;

  /** Check if a path is a symbolic link. */
  lstat(path: string): Promise<Stats>;

  /** Read directory contents with file type info. */
  readdir(path: string, options: { withFileTypes: true }): Promise<Dirent[]>;

  /** Create a directory (recursive). */
  mkdir(path: string): Promise<void>;

  /** Create a readable stream for a file. */
  createReadStream(path: string, encoding: BufferEncoding): ReadStream;

  /** Spawn a child process. Returns the ChildProcess handle. */
  spawn(
    command: string,
    args: string[],
    options: {
      cwd: string;
      env?: Record<string, string>;
      detached?: boolean;
      stdio?: Array<"pipe" | "ignore">;
    },
  ): ChildProcess;
}

/**
 * Default local filesystem + process operations.
 * This is what tools use when running on the local machine.
 */
export const localOperations: ToolOperations = {
  readFile: (path) => fs.readFile(path, "utf-8"),

  writeFile: async (path, content) => {
    const { dirname } = await import("node:path");
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.writeFile(path, content, "utf-8");
  },

  stat: (path) => fs.stat(path),

  lstat: (path) => fs.lstat(path),

  readdir: (path, options) => fs.readdir(path, options) as Promise<Dirent[]>,

  mkdir: (path) => fs.mkdir(path, { recursive: true }).then(() => {}),

  createReadStream: (path, encoding) => createReadStream(path, { encoding }),

  spawn: (command, args, options) =>
    spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      detached: options.detached,
      stdio: options.stdio as Parameters<typeof spawn>[2] extends { stdio: infer S } ? S : never,
    }),
};
