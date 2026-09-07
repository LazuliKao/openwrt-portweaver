export type RatholeMode = "client" | "server";

export interface RatholeStatus {
  enabled: boolean;
  instances: {
    id: number;
    name: string;
    mode: RatholeMode;
    state: string;
    last_error: string;
  }[];
}
