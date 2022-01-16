import { Plugin } from "../core/client.ts";
import { parseUserMask, Raw, UserMask } from "../core/parsers.ts";

export interface KillEvent {
  /** User who sent the KILL. */
  origin: UserMask;

  /** Nick who is killed. */
  nick: string;

  /** Comment of the KILL. */
  comment: string;
}

export interface KillParams {
  commands: {
    /** Kills a `nick` from the server with a `comment`. */
    kill(nick: string, comment: string): void;
  };
  events: {
    "kill": KillEvent;
  };
}

export const killPlugin: Plugin<KillParams> = (client) => {
  const sendKill = (...params: string[]) => {
    client.send("KILL", ...params);
  };

  const emitKill = (msg: Raw) => {
    if (msg.command !== "KILL") {
      return;
    }

    const { prefix, params: [nick, comment] } = msg;
    const origin = parseUserMask(prefix);

    client.emit("kill", { origin, nick, comment });
  };

  client.kill = sendKill;
  client.on("raw", emitKill);
};
