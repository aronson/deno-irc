import { type ClientError, type ErrorArgs, toClientError } from "./errors.ts";
import { EventEmitter, type EventEmitterOptions } from "./events.ts";
import { Hooks } from "./hooks.ts";
import { Parser, type Raw } from "./parsers.ts";
import { loadPlugins, type Plugin } from "./plugins.ts";
import {
  type AnyCommand,
  type AnyError,
  type AnyRawCommand,
  type AnyReply,
  PROTOCOL,
} from "./protocol.ts";

type AnyRawEventName = `raw:${AnyCommand | AnyReply | AnyError}`;

/** Removes undefined trailing parameters from send() input. */
export function removeUndefinedParameters(params: (string | undefined)[]) {
  for (let i = params.length - 1; i >= 0; --i) {
    params[i] === undefined ? params.pop() : i = 0;
  }
}

/** Prefixes trailing parameter with ':'. */
export function prefixTrailingParameter(params: (string | undefined)[]) {
  const last = params.length - 1;
  if (
    params.length > 0 &&
    (params[last]?.[0] === ":" || params[last]?.includes(" ", 1))
  ) {
    params[last] = ":" + params[last];
  }
}

/** Prepares and encodes raw message. */
export function encodeRawMessage(
  command: string,
  params: (string | undefined)[],
  encoder: TextEncoder,
  skipSuffix?: boolean,
) {
  const raw = (command + " " + params.join(" ")).trimEnd() +
    (skipSuffix ? "" : "\r\n");
  const bytes = encoder.encode(raw);
  const tuple: [raw: string, bytes: Uint8Array] = [raw, bytes];
  return tuple;
}

export interface CoreFeatures {
  options: EventEmitterOptions & {
    /** Size of the buffer that receives data from server.
     *
     * Default to `4096` bytes. */
    bufferSize?: number;
  };

  events: {
    "connecting": RemoteAddr;
    "connected": RemoteAddr;
    "disconnected": RemoteAddr;
    "error": ClientError;
    "raw": Raw; // never be emitted, but using it will generate all raw events
  } & { [K in AnyRawEventName]: Raw };

  state: {
    remoteAddr: RemoteAddr;
  };

  utils: Record<never, never>;
}

export type ConnectOptions = {
  tls?: boolean;
  path?: string;
};

export function generateRawEvents<
  T extends keyof typeof PROTOCOL,
  U extends typeof PROTOCOL[T],
  V extends `raw:${U[keyof U] extends string ? U[keyof U] : never}`[],
>(type: T) {
  return Object
    .values(PROTOCOL[type])
    .map((command) => `raw:${command}`) as V;
}

const BUFFER_SIZE = 4096;

export interface RemoteAddr {
  hostname: string;
  port: number;
  tls?: boolean;
  path?: string;
}

/** How to connect to a server */
interface ConnectImpl {
  noTls(opts: Deno.ConnectOptions): Promise<Deno.Conn>;
  withTls(opts: Deno.ConnectTlsOptions): Promise<Deno.Conn>;
}

export class CoreClient<
  TEvents extends CoreFeatures["events"] = CoreFeatures["events"],
> extends EventEmitter<TEvents> {
  readonly state: CoreFeatures["state"];
  readonly utils: CoreFeatures["utils"];

  protected connectImpl: ConnectImpl = {
    noTls: Deno.connect,
    withTls: Deno.connectTls,
  };
  protected conn: Deno.Conn | null = null;
  protected hooks = new Hooks<CoreClient<TEvents>>(this);

  readonly decoder = new TextDecoder();
  readonly encoder = new TextEncoder();
  readonly parser = new Parser();
  private buffer: Uint8Array;

  constructor(
    // deno-lint-ignore no-explicit-any
    plugins: Plugin<any, any>[],
    options: Readonly<CoreFeatures["options"]>,
  ) {
    super(options);

    this.buffer = new Uint8Array(options.bufferSize ?? BUFFER_SIZE);
    this.state = { remoteAddr: { hostname: "", port: 0, tls: false } };
    this.utils = {};

    // The 'raw' event is never emitted. But when the client subscribes to it,
    // it will be translated into ALL available raw events.

    this.createMultiEvent("raw", generateRawEvents("ALL"));

    // When `loadPlugins` is called, plugins can add their own error listeners.
    // In order to keep the default error throwing behavior (at least one error
    // listener is required to handle errors), `memorizeCurrentListenerCounts`
    // should always be called after to ignore already added error listeners.

    loadPlugins(this, options, plugins);
    this.memorizeCurrentListenerCounts();
  }

  /** Connects to a server using an hostname and a port.
   *
   * If `tls=true`, attempts to connect using a TLS connection.
   *
   * `path` is only used when client is instantiated with `websocket: true`.
   *
   * Resolves when connected. */
  async connect(
    hostname: string,
    port: number,
    options?: ConnectOptions,
  ): Promise<Deno.Conn | null> {
    const { tls = false } = options ?? {};
    this.state.remoteAddr = { hostname, port, tls };

    if (this.conn !== null) {
      this.close();
    }

    const { remoteAddr } = this.state;
    this.emit("connecting", remoteAddr);

    try {
      this.conn = await (tls
        ? this.connectImpl.withTls({ hostname, port })
        : this.connectImpl.noTls({ hostname, port }));
      this.emit("connected", remoteAddr);
    } catch (error) {
      this.emitError("connect", error);
      return null;
    }

    this.loop(this.conn);

    return this.conn;
  }

  private async loop(conn: Deno.Conn): Promise<void> {
    for (;;) {
      const chunks = await this.read(conn);
      if (chunks === null) break;

      const messageGenerator = this.parser.parseMessages(chunks);

      for (const msg of messageGenerator) {
        this.emit(`raw:${msg.command}`, msg);
      }
    }

    this.close();
  }

  private async read(conn: Deno.Conn): Promise<string | null> {
    let read: number | null;

    try {
      read = await conn.read(this.buffer);
      if (read === null) return null;
    } catch (error) {
      this.emitError("read", error);
      return null;
    }

    const bytes = this.buffer.subarray(0, read);
    const chunks = this.decoder.decode(bytes);

    return chunks;
  }

  private close(): void {
    if (this.conn === null) {
      return;
    }

    try {
      this.conn.close();
      this.emit("disconnected", this.state.remoteAddr);
    } catch (error) {
      this.emitError("close", error);
    } finally {
      this.conn = null;
    }
  }

  /** Sends a raw message to the server.
   *
   * Resolves with the raw message sent to the server,
   * or `null` if nothing has been sent. */
  async send(
    command: AnyRawCommand,
    ...params: (string | undefined)[]
  ): Promise<string | null> {
    if (this.conn === null) {
      this.emitError("write", "Unable to send message", this.send);
      return null;
    }

    removeUndefinedParameters(params);

    prefixTrailingParameter(params);

    const [raw, bytes] = encodeRawMessage(command, params, this.encoder);

    // Prepares and encodes raw message.
    try {
      await this.conn.write(bytes);
      return raw;
    } catch (error) {
      this.emitError("write", error);
      return null;
    }
  }

  /** Disconnects from the server. */
  disconnect(): void {
    this.close();
  }

  /** Emits properly an error. */
  emitError(...args: ErrorArgs): void {
    const [, error] = args;
    const isSilentError = error instanceof Deno.errors.BadResource ||
      error instanceof Deno.errors.Interrupted;
    if (isSilentError) {
      return;
    }
    this.emit("error", toClientError(...args));
  }
}
