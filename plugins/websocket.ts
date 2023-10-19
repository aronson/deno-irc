import {
  encodeRawMessage,
  prefixTrailingParameter,
  removeUndefinedParameters,
} from "../core/client.ts";
import { parseMessage } from "../core/parsers.ts";
import { createPlugin } from "../core/plugins.ts";

interface WebsocketFeatures {
  options: {
    websocket?: boolean;
  };
}

const INSECURE_PORT = 80;
const TLS_PORT = 443;

export default createPlugin("websocket", [])<WebsocketFeatures>(
  (client, options) => {
    if (!options.websocket) return;

    let websocket: WebSocket | null = null;

    const openHandler = () => {
      client.emit("connected", client.state.remoteAddr);
    };

    const messageHandler = (message: MessageEvent) => {
      try {
        const msg = parseMessage(message.data);
        client.emit(`raw:${msg.command}`, msg);
      } catch (error) {
        client.emitError("read", error);
      }
    };

    const errorHandler = (event: Event) => {
      client.emitError("read", new Error(event.toString()));
    };

    client.hooks.hookCall("connect", (_, serverAndPath, port, tls) => {
      port = port ?? tls ? TLS_PORT : INSECURE_PORT;
      const websocketPrefix = tls ? "wss://" : "ws://";
      const websocketUrl = new URL(
        `${websocketPrefix}${serverAndPath}:${port}`,
      );
      if (websocket !== null) {
        websocket.close(1000);
      }

      client.state.remoteAddr = {
        hostname: websocketUrl.hostname,
        port,
        tls,
        path: websocketUrl.pathname,
      };
      const { remoteAddr } = client.state;
      client.emit("connecting", remoteAddr);

      try {
        websocket = new WebSocket(websocketUrl);
        websocket.addEventListener("error", errorHandler);
        websocket.addEventListener("open", openHandler);
        websocket.addEventListener("message", messageHandler);
      } catch (error) {
        client.emitError("connect", error);
        return null;
      }

      return null;
    });

    client.hooks.hookCall("send", (_, command, ...params) => {
      if (websocket === null) {
        client.emitError("write", "Unable to send message", client.send);
        return null;
      }

      removeUndefinedParameters(params);

      prefixTrailingParameter(params);

      const [raw, bytes] = encodeRawMessage(command, params, client.encoder);

      try {
        websocket.send(bytes);
        return raw;
      } catch (error) {
        client.emitError("write", error);
        return null;
      }
    });

    client.hooks.hookCall("disconnect", () => {
      try {
        websocket?.close(1000);
        client.emit("disconnected", client.state.remoteAddr);
      } catch (error) {
        client.emitError("close", error);
      } finally {
        websocket = null;
      }
    });
  },
);