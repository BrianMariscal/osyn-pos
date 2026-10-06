/**
 * Tiempo real con Supabase Realtime (protocolo Phoenix, sin SDK).
 *
 * No aplica los datos que llegan: cada aviso de cambio solo dispara la sync
 * incremental normal, así se respetan el merge, los tombstones y el rebase de
 * contadores. Si Realtime no está habilitado en la base (falta ejecutar
 * supabase/migracion-realtime.sql) o no hay red, la app sigue con la revisión
 * periódica de respaldo.
 */
import type { SyncTableKey } from "../core/types";

export interface RealtimeOptions {
  supabaseUrl: string;
  apiKey: string;
  /** Token vigente del usuario (las RLS filtran qué cambios recibe). */
  token: () => string | null;
  tables: () => readonly SyncTableKey[];
  /** Se llama ante cualquier cambio en una tabla sincronizada. */
  onChange: (table: string) => void;
  onStatus?: (live: boolean) => void;
  /** Inyectable para pruebas. */
  WebSocketImpl?: typeof WebSocket;
}

interface PhoenixMessage {
  topic: string;
  event: string;
  payload: Record<string, unknown>;
  ref: string | null;
  join_ref?: string | null;
}

const TOPIC = "realtime:pos-sync";
const HEARTBEAT_MS = 25_000;
const MAX_BACKOFF_MS = 30_000;

export class RealtimeSync {
  private socket: WebSocket | null = null;
  private ref = 0;
  private joinRef: string | null = null;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private attempts = 0;
  private stopped = true;
  private live = false;
  private lastToken: string | null = null;

  constructor(private options: RealtimeOptions) {}

  get isLive(): boolean {
    return this.live;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    this.retry = undefined;
    this.teardown();
  }

  /** Tras renovar la sesión: el canal sigue autorizado con el token nuevo. */
  refreshToken(): void {
    const token = this.options.token();
    if (!token || token === this.lastToken || !this.joinRef) return;
    this.lastToken = token;
    this.send({ topic: TOPIC, event: "access_token", payload: { access_token: token }, ref: this.nextRef(), join_ref: this.joinRef });
  }

  private url(): string {
    const base = this.options.supabaseUrl.replace(/\/$/, "").replace(/^http/, "ws");
    return `${base}/realtime/v1/websocket?apikey=${encodeURIComponent(this.options.apiKey)}&vsn=1.0.0`;
  }

  private connect(): void {
    const token = this.options.token();
    const Impl = this.options.WebSocketImpl ?? (typeof WebSocket !== "undefined" ? WebSocket : undefined);
    if (this.stopped || !token || !Impl) return;
    let socket: WebSocket;
    try {
      socket = new Impl(this.url());
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      this.join(token);
      this.heartbeat = setInterval(() => {
        this.send({ topic: "phoenix", event: "heartbeat", payload: {}, ref: this.nextRef() });
      }, HEARTBEAT_MS);
    };
    socket.onmessage = (event) => this.handle(String(event.data));
    socket.onclose = () => {
      this.teardown();
      this.scheduleReconnect();
    };
    socket.onerror = () => {
      try {
        socket.close();
      } catch {
        /* ya cerrado */
      }
    };
  }

  private join(token: string): void {
    this.lastToken = token;
    this.joinRef = this.nextRef();
    this.send({
      topic: TOPIC,
      event: "phx_join",
      payload: {
        config: {
          broadcast: { ack: false, self: false },
          presence: { key: "" },
          postgres_changes: this.options.tables().map((table) => ({ event: "*", schema: "public", table })),
          private: false
        },
        access_token: token
      },
      ref: this.joinRef,
      join_ref: this.joinRef
    });
  }

  private handle(raw: string): void {
    let message: PhoenixMessage;
    try {
      message = JSON.parse(raw) as PhoenixMessage;
    } catch {
      return;
    }
    if (message.topic !== TOPIC) return;
    if (message.event === "phx_reply" && message.ref === this.joinRef) {
      const ok = (message.payload as { status?: string }).status === "ok";
      this.attempts = ok ? 0 : this.attempts;
      this.setLive(ok);
      if (ok) this.options.onChange("*"); // ponerse al día al (re)conectar
      return;
    }
    if (message.event === "system") {
      // Realtime avisa aquí si no pudo suscribirse (p. ej. tablas fuera de la publicación).
      const status = (message.payload as { status?: string }).status;
      if (status && status !== "ok") this.setLive(false);
      return;
    }
    if (message.event === "phx_error" || message.event === "phx_close") {
      this.setLive(false);
      return;
    }
    if (message.event === "postgres_changes") {
      const data = (message.payload as { data?: { table?: string } }).data;
      this.options.onChange(data?.table ?? "*");
    }
  }

  private setLive(live: boolean): void {
    if (this.live === live) return;
    this.live = live;
    this.options.onStatus?.(live);
  }

  private send(message: PhoenixMessage): void {
    if (this.socket?.readyState === 1) this.socket.send(JSON.stringify(message));
  }

  private nextRef(): string {
    this.ref += 1;
    return String(this.ref);
  }

  private teardown(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    this.joinRef = null;
    this.setLive(false);
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
      try {
        socket.close();
      } catch {
        /* ya cerrado */
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.retry) return;
    const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.attempts);
    this.attempts += 1;
    this.retry = setTimeout(() => {
      this.retry = undefined;
      this.connect();
    }, delay);
  }
}
