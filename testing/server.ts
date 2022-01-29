import { MockClient, MockCoreClient } from "./client.ts";
import { MockConn } from "./conn.ts";

export class MockServer {
  private client: { conn: MockConn | null };

  constructor(client: MockClient | MockCoreClient) {
    this.client = client;
  }

  private get conn(): MockConn {
    if (this.client.conn === null) {
      throw new Error("Missing mock connection");
    }

    return this.client.conn;
  }

  /** Receives the raw messages. */
  receive(): string[] {
    try {
      return this.conn.raw;
    } finally {
      this.conn.raw = [];
    }
  }

  /** Sends raw messages. */
  send(raw: string | string[]): void {
    if (!Array.isArray(raw)) {
      raw = [raw];
    }

    return this.conn.emit("read", raw);
  }

  /** Closes the server. */
  shutdown(): void {
    this.conn.emit("read", null);
  }
}
