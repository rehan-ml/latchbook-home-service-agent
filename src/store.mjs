import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { seedState } from "./seed.mjs";

export class JsonStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.queue = Promise.resolve();
  }

  async read() {
    try {
      return JSON.parse(await readFile(this.filePath, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return seedState();
      throw error;
    }
  }

  async update(change) {
    const operation = this.queue.then(async () => {
      const state = await this.read();
      const result = await change(state);
      await mkdir(dirname(this.filePath), { recursive: true });
      const temporary = `${this.filePath}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", flag: "w" });
      await rename(temporary, this.filePath);
      return result;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }

  async reset() {
    return this.update((state) => {
      Object.keys(state).forEach((key) => delete state[key]);
      Object.assign(state, seedState());
      return state;
    });
  }
}
